begin;
-- Human confirmation is independent of medical and vendor scheduling authority.
alter table public.service_provider_services add column accepts_appointment_requests boolean not null default false;
create table public.service_provider_request_settings (
 location_id uuid primary key references public.service_provider_locations(id),
 requests_enabled boolean not null default false,
 instructions text check(length(instructions)<=1000),
 minimum_notice_hours integer not null default 24 check(minimum_notice_hours between 0 and 336),
 maximum_advance_days integer not null default 60 check(maximum_advance_days between 1 and 180),
 updated_by uuid references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.appointment_requests (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id), pet_id uuid not null references public.pets(id), owner_id uuid not null references auth.users(id),
 location_id uuid not null references public.service_provider_locations(id), service_id uuid not null references public.service_provider_services(id),
 contact_name text not null check(length(btrim(contact_name)) between 1 and 120), contact_email text not null check(length(contact_email)<=254 and public.bp_email(contact_email)), contact_phone text check(length(contact_phone)<=40 and public.bp_phone(contact_phone)), note text check(length(note)<=1000),
 time_zone text not null, status text not null default 'requested' check(status in ('requested','provider_proposed','confirmed','declined','withdrawn','cancelled_by_owner','cancelled_by_provider','expired')),
 current_proposal_id uuid, appointment_id uuid unique references public.appointments(id), provider_response_note text check(length(provider_response_note)<=500),
 expires_at timestamptz not null default now()+interval '7 days' check(isfinite(expires_at)), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.appointment_requests add constraint request_lifetime check(expires_at<=created_at+interval '7 days');
alter table public.appointment_requests add constraint request_confirmation_reference check((status in ('confirmed','cancelled_by_owner','cancelled_by_provider'))=(appointment_id is not null));
create unique index appointment_request_open_identity on public.appointment_requests(owner_id,pet_id,location_id,service_id) where status in ('requested','provider_proposed');
create index appointment_request_owner_page on public.appointment_requests(owner_id,created_at desc,id desc);
create index appointment_request_location_inbox on public.appointment_requests(location_id,status,created_at desc,id desc);
create table public.appointment_request_windows (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.appointment_requests(id),position integer not null check(position between 1 and 3),
 starts_at timestamptz not null,ends_at timestamptz not null,created_at timestamptz not null default now(),unique(request_id,position),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at-starts_at between interval '30 minutes' and interval '8 hours')
);
create table public.appointment_request_proposals (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.appointment_requests(id),proposed_by uuid not null references auth.users(id),
 starts_at timestamptz not null,ends_at timestamptz not null,time_zone text not null,message text check(length(message)<=500),
 status text not null default 'pending' check(status in ('pending','accepted','declined','superseded','withdrawn','expired')),
 expires_at timestamptz not null,created_at timestamptz not null default now(),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at and ends_at-starts_at<=interval '8 hours'),
 check(isfinite(expires_at) and expires_at<=created_at+interval '48 hours')
);
create unique index appointment_request_pending_proposal on public.appointment_request_proposals(request_id) where status='pending';
alter table public.appointment_requests add foreign key(current_proposal_id) references public.appointment_request_proposals(id);
create table public.appointment_request_events (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.appointment_requests(id),actor_user_id uuid references auth.users(id),
 event_type text not null check(event_type in ('submitted','provider_proposed','owner_declined_proposal','provider_confirmed','owner_accepted_proposal','provider_declined','owner_withdrew','owner_cancelled','provider_cancelled','expired')),
 message text check(length(message)<=500),created_at timestamptz not null default now()
);
create index appointment_request_history on public.appointment_request_events(request_id,created_at,id);
do $$ declare t text;begin foreach t in array array['service_provider_request_settings','appointment_requests','appointment_request_windows','appointment_request_proposals','appointment_request_events'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on public.%I from service_role',t);end if;end loop;end $$;
create function public.ar_authorize(p_location uuid,p_write boolean default true) returns void language plpgsql security definer set search_path='' as $$
declare org uuid; r text;begin
 select organization_id into org from public.service_provider_locations where id=p_location;
 if org is null then raise exception 'Location unavailable';end if;
 perform public.bp_authorize(org,p_location,false);
 select role into r from public.service_provider_memberships where organization_id=org and user_id=auth.uid() and active;
 if p_write and r not in ('owner','admin','scheduling_manager') then raise exception 'Request management permission required';end if;
end $$;
create function public.service_provider_request_intake(p_location uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('locationId',l.id,'businessName',o.name,'locationName',coalesce(p.display_name,o.name),'timeZone',p.time_zone,'instructions',s.instructions,'minimumNoticeHours',s.minimum_notice_hours,'maximumAdvanceDays',s.maximum_advance_days,
 'services',(select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'category',v.category,'description',v.description) order by v.display_order,v.id) from public.service_provider_services v where v.location_id=l.id and v.active and v.accepts_appointment_requests))
 from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id join public.service_provider_location_profiles p on p.location_id=l.id join public.service_provider_request_settings s on s.location_id=l.id
 where l.id=p_location and l.status='active' and o.status='active' and p.profile_status='published' and s.requests_enabled and exists(select 1 from pg_catalog.pg_timezone_names where name=p.time_zone) and exists(select 1 from public.service_provider_services v where v.location_id=l.id and v.active and v.accepts_appointment_requests)
$$;
create function public.save_service_provider_request_settings(p_organization uuid,p_location uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.ar_authorize(p_location);
 if not exists(select 1 from public.service_provider_locations where id=p_location and organization_id=p_organization) then raise exception 'Location mismatch';end if;
 perform public.bp_object(p_data,array['requests_enabled','instructions','minimum_notice_hours','maximum_advance_days'],4000);
 insert into public.service_provider_request_settings(location_id,requests_enabled,instructions,minimum_notice_hours,maximum_advance_days,updated_by)
 values(p_location,(p_data->>'requests_enabled')::boolean,nullif(btrim(p_data->>'instructions'),''),(p_data->>'minimum_notice_hours')::integer,(p_data->>'maximum_advance_days')::integer,auth.uid())
 on conflict(location_id) do update set requests_enabled=excluded.requests_enabled,instructions=excluded.instructions,minimum_notice_hours=excluded.minimum_notice_hours,maximum_advance_days=excluded.maximum_advance_days,updated_by=auth.uid(),updated_at=now();
end $$;
create function public.set_service_provider_service_requestable(p_organization uuid,p_location uuid,p_service uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin perform public.ar_authorize(p_location);
 if not exists(select 1 from public.service_provider_locations where id=p_location and organization_id=p_organization) then raise exception 'Location mismatch';end if;
 update public.service_provider_services set accepts_appointment_requests=p_enabled where id=p_service and location_id=p_location and active;
 if not found then raise exception 'Service unavailable';end if;
end $$;
create function public.ar_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.id,new.household_id,new.pet_id,new.owner_id,new.location_id,new.service_id,new.contact_name,new.contact_email,new.contact_phone,new.time_zone,new.created_at) is distinct from (old.id,old.household_id,old.pet_id,old.owner_id,old.location_id,old.service_id,old.contact_name,old.contact_email,old.contact_phone,old.time_zone,old.created_at) then raise exception 'Request identity immutable';end if;
 if not exists(select 1 from public.pets p join public.households h on h.id=p.household_id where p.id=new.pet_id and h.id=new.household_id and h.owner_id=new.owner_id) or not exists(select 1 from public.service_provider_services where id=new.service_id and location_id=new.location_id) or not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Invalid request identity';end if;
 if tg_op='UPDATE' and old.appointment_id is not null and new.appointment_id is distinct from old.appointment_id then raise exception 'Linked appointment immutable';end if;
 if new.current_proposal_id is not null and not exists(select 1 from public.appointment_request_proposals where id=new.current_proposal_id and request_id=new.id) then raise exception 'Invalid proposal reference';end if;
 if new.appointment_id is not null and not exists(select 1 from public.appointments where id=new.appointment_id and household_id=new.household_id and pet_id=new.pet_id and created_by=new.owner_id and source='pawport') then raise exception 'Invalid appointment reference';end if;
 new.updated_at=now();return new;
end $$;
create trigger appointment_request_identity before insert or update on public.appointment_requests for each row execute function public.ar_identity();
create function public.ar_append_only() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Request history is immutable';end $$;
create trigger appointment_request_event_immutable before update or delete on public.appointment_request_events for each row execute function public.ar_append_only();
create trigger appointment_request_window_immutable before update or delete on public.appointment_request_windows for each row execute function public.ar_append_only();
create function public.submit_appointment_request(p_pet uuid,p_location uuid,p_service uuid,p_contact_name text,p_phone text,p_note text,p_windows jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid; target uuid; intake jsonb; mail text; w jsonb; a timestamptz;b timestamptz;pos integer:=0;begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform pg_advisory_xact_lock(hashtextextended('appointment-request:'||auth.uid()::text,0));
 mail:=public.bd_auth_email();if mail is null then raise exception 'Confirm your email before requesting an appointment';end if;
 select p.household_id into h from public.pets p join public.households hh on hh.id=p.household_id where p.id=p_pet and hh.owner_id=auth.uid() for share of p,hh;
 if h is null then raise exception 'Pet unavailable';end if;
 -- Serialize intake changes with submission without granting business access to owners.
 perform 1 from public.service_provider_organizations o join public.service_provider_locations l on l.organization_id=o.id where l.id=p_location for share of o,l;
 intake:=public.service_provider_request_intake(p_location);
 if intake is null or not exists(select 1 from public.service_provider_services where id=p_service and location_id=p_location and active and accepts_appointment_requests) then raise exception 'Appointment requests unavailable';end if;
 with expired as (update public.appointment_requests set status='expired' where owner_id=auth.uid() and status in ('requested','provider_proposed') and expires_at<=now() returning id) insert into public.appointment_request_events(request_id,event_type) select id,'expired' from expired;
 update public.appointment_request_proposals q set status='expired' from public.appointment_requests r where q.request_id=r.id and r.owner_id=auth.uid() and r.status='expired' and q.status='pending';
 if (select count(*) from public.appointment_requests where owner_id=auth.uid() and created_at>now()-interval '1 day')>=20 or (select count(*) from public.appointment_requests where owner_id=auth.uid() and status in ('requested','provider_proposed'))>=10 then raise exception 'Request limit reached';end if;
 if jsonb_typeof(p_windows) is distinct from 'array' or jsonb_array_length(p_windows) not between 1 and 3 then raise exception 'Choose one to three preferred times';end if;
 insert into public.appointment_requests(household_id,pet_id,owner_id,location_id,service_id,contact_name,contact_email,contact_phone,note,time_zone)
 values(h,p_pet,auth.uid(),p_location,p_service,btrim(p_contact_name),mail,nullif(btrim(p_phone),''),nullif(btrim(p_note),''),intake->>'timeZone') returning id into target;
 for w in select value from jsonb_array_elements(p_windows) loop
 perform public.bp_object(w,array['starts_at','ends_at'],500);a:=(w->>'starts_at')::timestamptz;b:=(w->>'ends_at')::timestamptz;pos:=pos+1;
 if a is null or b is null or not isfinite(a) or not isfinite(b) or a<=now() or a<now()+make_interval(hours=>(intake->>'minimumNoticeHours')::integer) or b>now()+make_interval(days=>(intake->>'maximumAdvanceDays')::integer) then raise exception 'Preferred time outside request horizon';end if;
 if exists(select 1 from public.appointment_request_windows where request_id=target and starts_at<b and ends_at>a) then raise exception 'Preferred times overlap';end if;
 insert into public.appointment_request_windows(request_id,position,starts_at,ends_at) values(target,pos,a,b);
 end loop;
 insert into public.appointment_request_events(request_id,actor_user_id,event_type) values(target,auth.uid(),'submitted');return target;
end $$;
-- Extend notification constraints without weakening existing source references.
alter table public.notifications add column appointment_request_id uuid references public.appointment_requests(id);
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in ('availability_match','care_due','appointment_reminder','verification_update','appointment_request_update'));
alter table public.notifications drop constraint notifications_action_url_check;
alter table public.notifications add constraint notifications_action_url_check check(
 (type='availability_match' and action_url ~ '^/openings/[a-f0-9-]{36}$') or
 (type='care_due' and action_url ~ '^/care/plans/[a-f0-9-]{36}$') or
 (type='appointment_reminder' and action_url ~ '^/appointments/[a-f0-9-]{36}$') or
 (type='verification_update' and action_url ~ '^/pets/[a-f0-9-]{36}/records$') or
 (type='appointment_request_update' and action_url ~ '^/appointments/requests/[a-f0-9-]{36}$'));
alter table public.notifications drop constraint owner_notification_references;
alter table public.notifications add constraint owner_notification_references check(
 (type in ('care_due','availability_match') and appointment_reminder_id is null and verification_request_id is null and subject_pet_id is null and appointment_request_id is null) or
 (type='appointment_reminder' and channel='in_app' and action_url is not null and appointment_reminder_id is not null and verification_request_id is null and subject_pet_id is not null and appointment_request_id is null) or
 (type='verification_update' and channel='in_app' and action_url is not null and verification_request_id is not null and appointment_reminder_id is null and subject_pet_id is not null and appointment_request_id is null) or
 (type='appointment_request_update' and channel='in_app' and action_url is not null and appointment_request_id is not null and subject_pet_id is not null and appointment_reminder_id is null and verification_request_id is null));
create function public.ar_notification_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' and new.appointment_request_id is distinct from old.appointment_request_id then raise exception 'Request notification identity immutable';end if;
 if new.type='appointment_request_update' and not exists(select 1 from public.appointment_requests r where r.id=new.appointment_request_id and r.owner_id=new.user_id and r.pet_id=new.subject_pet_id and new.action_url='/appointments/requests/'||r.id::text and new.dedupe_key like 'appointment-request:'||r.id::text||':%') then raise exception 'Invalid request notification';end if;return new;
end $$;
create trigger appointment_request_notification before insert or update on public.notifications for each row execute function public.ar_notification_guard();
create function public.ar_notify(p_request uuid,p_key text,p_title text) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(user_id,type,title,body,action_url,dedupe_key,subject_pet_id,appointment_request_id)
 select owner_id,'appointment_request_update',p_title,'View your appointment request for details.','/appointments/requests/'||id::text,'appointment-request:'||id::text||':'||p_key,pet_id,id from public.appointment_requests where id=p_request on conflict do nothing;
$$;
create function public.ar_create_appointment(p_request uuid,p_start timestamptz,p_end timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.appointment_requests;target uuid;begin
 select * into r from public.appointment_requests where id=p_request for update;
 if r.appointment_id is not null then return r.appointment_id;end if;
 insert into public.appointments(household_id,pet_id,created_by,source,status,google_place_id,provider_name,appointment_type,title,starts_at,ends_at,time_zone,location_text)
 select r.household_id,r.pet_id,r.owner_id,'pawport','confirmed',l.google_place_id,o.name,
 case s.category when 'emergency_veterinary' then 'emergency_vet' when 'walking' then 'walker' when 'sitting' then 'sitter' when 'retail' then 'other' else s.category end,s.name,p_start,p_end,r.time_zone,
 nullif(left(concat_ws(', ',p.address_line1,p.address_line2,p.city,p.region,p.postal_code,p.country_code),300),'')
 from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id join public.service_provider_services s on s.id=r.service_id left join public.service_provider_location_profiles p on p.location_id=l.id where l.id=r.location_id returning id into target;
 insert into public.appointment_reminders(appointment_id,user_id,reminder_minutes) values(target,r.owner_id,1440),(target,r.owner_id,120);
 update public.appointment_requests set appointment_id=target,status='confirmed' where id=r.id;return target;
end $$;
-- All transitions lock organization before request, consistently with team/profile mutations.
create function public.ar_transition(p_request uuid,p_action text,p_start timestamptz default null,p_end timestamptz default null,p_message text default null,p_proposal uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.appointment_requests; q public.appointment_request_proposals; loc uuid;org uuid;target uuid;event text;provider_action boolean;begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 provider_action:=p_action in ('confirm','propose','decline','provider_cancel');
 if p_action not in ('confirm','propose','decline','provider_cancel','accept','reject_proposal','withdraw','owner_cancel') or length(p_message)>500 then raise exception 'Invalid request action';end if;
 select location_id into loc from public.appointment_requests where id=p_request and (provider_action or owner_id=auth.uid());
 if loc is null then raise exception 'Request unavailable';end if;
 select organization_id into org from public.service_provider_locations where id=loc;
 if provider_action then perform public.ar_authorize(loc);else perform 1 from public.service_provider_organizations where id=org for update;end if;
 select * into r from public.appointment_requests where id=p_request for update;
 if not provider_action and r.owner_id<>auth.uid() then raise exception 'Request unavailable';end if;
 if p_action in ('confirm','accept') and r.status='confirmed' then
 if p_action='accept' and not exists(select 1 from public.appointment_request_proposals where id=p_proposal and id=r.current_proposal_id and request_id=r.id and status='accepted') then raise exception 'Proposal unavailable';end if;
 return r.appointment_id;end if;
 if p_action in ('provider_cancel','owner_cancel') then
 if r.status<>'confirmed' then raise exception 'Only confirmed requests can be cancelled';end if;
 update public.appointments set status='cancelled',updated_at=now() where id=r.appointment_id and source='pawport' and household_id=r.household_id and pet_id=r.pet_id and status='confirmed';
 if not found then raise exception 'Confirmed appointment unavailable';end if;
 update public.appointment_requests set status=case when provider_action then 'cancelled_by_provider' else 'cancelled_by_owner' end,provider_response_note=case when provider_action then p_message else provider_response_note end where id=r.id;
 event:=case when provider_action then 'provider_cancelled' else 'owner_cancelled' end;
 else
 if r.status not in ('requested','provider_proposed') or r.expires_at<=now() then raise exception 'Request is closed or expired';end if;
 if p_action in ('confirm','propose','accept') then
 if not exists(select 1 from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id where l.id=loc and l.status='active' and o.status='active') then raise exception 'Business unavailable';end if;
 if p_action='accept' then
 select * into q from public.appointment_request_proposals where id=p_proposal and id=r.current_proposal_id and request_id=r.id for update;
 if q.id is null or q.status<>'pending' or q.expires_at<=now() then raise exception 'Proposal expired or unavailable';end if;
 p_start:=q.starts_at;p_end:=q.ends_at;
 end if;
 if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_start<=now() or p_end<=p_start or p_end-p_start>interval '8 hours' or p_end>now()+make_interval(days=>(select maximum_advance_days from public.service_provider_request_settings where location_id=loc)) then raise exception 'Invalid appointment time';end if;
 end if;
 if p_action='confirm' then
 if not exists(select 1 from public.appointment_request_windows where request_id=r.id and starts_at<=p_start and ends_at>=p_end) then raise exception 'Propose a time outside the preferred windows';end if;
 update public.appointment_request_proposals set status='superseded' where request_id=r.id and status='pending';
 target:=public.ar_create_appointment(r.id,p_start,p_end);event:='provider_confirmed';
 elsif p_action='propose' then
 if (select count(*) from public.appointment_request_proposals where request_id=r.id)>=50 then raise exception 'Proposal limit reached';end if;
 update public.appointment_request_proposals set status='superseded' where request_id=r.id and status='pending';
 insert into public.appointment_request_proposals(request_id,proposed_by,starts_at,ends_at,time_zone,message,expires_at) values(r.id,auth.uid(),p_start,p_end,r.time_zone,p_message,least(now()+interval '48 hours',r.expires_at,p_start)) returning id into target;
 update public.appointment_requests set current_proposal_id=target,status='provider_proposed' where id=r.id;event:='provider_proposed';
 elsif p_action='accept' then
 update public.appointment_request_proposals set status='accepted' where id=q.id;
 target:=public.ar_create_appointment(r.id,p_start,p_end);event:='owner_accepted_proposal';
 elsif p_action='reject_proposal' then
 update public.appointment_request_proposals set status='declined' where id=p_proposal and id=r.current_proposal_id and request_id=r.id and status='pending' and expires_at>now();
 if not found then raise exception 'Proposal unavailable';end if;
 update public.appointment_requests set status='requested' where id=r.id;event:='owner_declined_proposal';
 elsif p_action='withdraw' then
 update public.appointment_request_proposals set status='withdrawn' where request_id=r.id and status='pending';
 update public.appointment_requests set status='withdrawn' where id=r.id;event:='owner_withdrew';
 elsif p_action='decline' then
 update public.appointment_request_proposals set status='withdrawn' where request_id=r.id and status='pending';
 update public.appointment_requests set status='declined',provider_response_note=p_message where id=r.id;event:='provider_declined';
 end if;end if;
 insert into public.appointment_request_events(request_id,actor_user_id,event_type,message) values(r.id,auth.uid(),event,p_message);
 if event='provider_proposed' then perform public.ar_notify(r.id,'proposal:'||target::text,'New appointment time proposed');
 elsif event='provider_confirmed' then perform public.ar_notify(r.id,'confirmed','Appointment confirmed');
 elsif event='provider_declined' then perform public.ar_notify(r.id,'declined','Appointment request declined');
 elsif event='provider_cancelled' then perform public.ar_notify(r.id,'provider-cancelled','Appointment cancelled');end if;
 return coalesce(target,r.id);
end $$;
create function public.ar_dto(p_id uuid,p_provider boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('requestId',r.id,'petName',p.name,'businessName',o.name,'locationName',coalesce(lp.display_name,o.name),'serviceName',s.name,'timeZone',r.time_zone,
 'status',case when r.status in ('requested','provider_proposed') and r.expires_at<=now() then 'expired' when r.status='provider_proposed' and q.expires_at<=now() then 'requested' else r.status end,
 'preferredWindows',coalesce((select jsonb_agg(jsonb_build_object('startsAt',w.starts_at,'endsAt',w.ends_at) order by position) from public.appointment_request_windows w where w.request_id=r.id),'[]'::jsonb),
 'proposal',case when q.id is not null then jsonb_build_object('id',q.id,'startsAt',q.starts_at,'endsAt',q.ends_at,'message',q.message,'expiresAt',q.expires_at,'status',case when q.status='pending' and q.expires_at<=now() then 'expired' else q.status end) end,
 'responseNote',r.provider_response_note,'createdAt',r.created_at,'expiresAt',r.expires_at,
 'history',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'type',e.event_type,'message',e.message,'createdAt',e.created_at) order by e.created_at,e.id) from (select * from public.appointment_request_events where request_id=r.id order by created_at desc,id desc limit 100) e),'[]'::jsonb))
 || case when p_provider then jsonb_build_object('species',p.species,'contactName',r.contact_name,'contactEmail',r.contact_email,'contactPhone',r.contact_phone,'note',r.note,'appointment',case when a.id is not null then jsonb_build_object('startsAt',a.starts_at,'endsAt',a.ends_at,'status',a.status) end)
 else jsonb_build_object('petId',p.id,'appointmentId',r.appointment_id) end
 from public.appointment_requests r join public.pets p on p.id=r.pet_id join public.service_provider_locations l on l.id=r.location_id join public.service_provider_organizations o on o.id=l.organization_id join public.service_provider_services s on s.id=r.service_id left join public.service_provider_location_profiles lp on lp.location_id=l.id left join public.appointment_request_proposals q on q.id=r.current_proposal_id left join public.appointments a on a.id=r.appointment_id where r.id=p_id;
$$;
create function public.my_appointment_request(p_request uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not exists(select 1 from public.appointment_requests where id=p_request and owner_id=auth.uid()) then raise exception 'Request unavailable';end if;return public.ar_dto(p_request,false);end $$;
create function public.my_appointment_requests(p_before timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 if (p_before is null)<>(p_before_id is null) or (p_before is not null and not isfinite(p_before)) then raise exception 'Invalid cursor';end if;
 return(select coalesce(jsonb_agg(public.ar_dto(x.id,false) order by x.created_at desc,x.id desc),'[]'::jsonb) from (select id,created_at from public.appointment_requests where owner_id=auth.uid() and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 25) x);end $$;
create function public.service_provider_appointment_request(p_organization uuid,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare l uuid;begin
 select r.location_id into l from public.appointment_requests r join public.service_provider_locations loc on loc.id=r.location_id where r.id=p_request and loc.organization_id=p_organization;
 perform public.ar_authorize(l,false);return public.ar_dto(p_request,true);end $$;
create function public.service_provider_appointment_requests(p_organization uuid,p_location uuid default null,p_before timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform public.bp_authorize(p_organization,null,false);
 if p_location is not null then perform public.ar_authorize(p_location,false);if not exists(select 1 from public.service_provider_locations where id=p_location and organization_id=p_organization) then raise exception 'Location mismatch';end if;end if;
 if (p_before is null)<>(p_before_id is null) or (p_before is not null and not isfinite(p_before)) then raise exception 'Invalid cursor';end if;
 return(select coalesce(jsonb_agg(public.ar_dto(x.id,true) order by x.created_at desc,x.id desc),'[]'::jsonb) from (select r.id,r.created_at from public.appointment_requests r join public.service_provider_locations l on l.id=r.location_id where l.organization_id=p_organization and public.service_provider_can_access_location(p_organization,l.id) and (p_location is null or l.id=p_location) and (p_before is null or (r.created_at,r.id)<(p_before,p_before_id)) order by r.created_at desc,r.id desc limit 25) x);end $$;
create function public.service_provider_request_settings(p_organization uuid,p_location uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform public.ar_authorize(p_location,false);
 if not exists(select 1 from public.service_provider_locations where id=p_location and organization_id=p_organization) then raise exception 'Location mismatch';end if;
 return jsonb_build_object('locationId',p_location,'settings',coalesce((select jsonb_build_object('requests_enabled',requests_enabled,'instructions',instructions,'minimum_notice_hours',minimum_notice_hours,'maximum_advance_days',maximum_advance_days) from public.service_provider_request_settings where location_id=p_location),jsonb_build_object('requests_enabled',false,'minimum_notice_hours',24,'maximum_advance_days',60)),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'enabled',accepts_appointment_requests) order by display_order,id) from public.service_provider_services where location_id=p_location and active),'[]'::jsonb));end $$;
-- Deliberately narrow public wrappers; internal transition helper is not executable by clients.
create function public.confirm_appointment_request(p_request uuid,p_start timestamptz,p_end timestamptz) returns uuid language sql security definer set search_path='' as $$select public.ar_transition(p_request,'confirm',p_start,p_end)$$;
create function public.propose_appointment_request_time(p_request uuid,p_start timestamptz,p_end timestamptz,p_message text default null) returns uuid language sql security definer set search_path='' as $$select public.ar_transition(p_request,'propose',p_start,p_end,p_message)$$;
create function public.accept_appointment_request_proposal(p_request uuid,p_proposal uuid) returns uuid language sql security definer set search_path='' as $$select public.ar_transition(p_request,'accept',p_proposal=>p_proposal)$$;
create function public.decline_appointment_request_proposal(p_request uuid,p_proposal uuid) returns uuid language sql security definer set search_path='' as $$select public.ar_transition(p_request,'reject_proposal',p_proposal=>p_proposal)$$;
create function public.withdraw_appointment_request(p_request uuid) returns uuid language sql security definer set search_path='' as $$select public.ar_transition(p_request,'withdraw')$$;
create function public.decline_appointment_request(p_request uuid,p_message text default null) returns uuid language sql security definer set search_path='' as $$select public.ar_transition(p_request,'decline',p_message=>p_message)$$;
create function public.cancel_requested_appointment_by_owner(p_request uuid) returns uuid language sql security definer set search_path='' as $$select public.ar_transition(p_request,'owner_cancel')$$;
create function public.cancel_requested_appointment_by_provider(p_request uuid,p_message text default null) returns uuid language sql security definer set search_path='' as $$select public.ar_transition(p_request,'provider_cancel',p_message=>p_message)$$;
create function public.expire_appointment_requests(p_limit integer default 200) returns integer language plpgsql security definer set search_path='' as $$declare r record;n integer:=0;begin
 if p_limit is null or p_limit not between 1 and 500 then raise exception 'Invalid batch';end if;
 for r in select id from public.appointment_requests where status in ('requested','provider_proposed') and expires_at<=now() order by expires_at,id limit p_limit for update skip locked loop
 update public.appointment_requests set status='expired' where id=r.id;
 update public.appointment_request_proposals set status='expired' where request_id=r.id and status='pending';
 insert into public.appointment_request_events(request_id,event_type) values(r.id,'expired');n:=n+1;
 end loop;return n;end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (left(p.proname,3)='ar_' or p.proname in ('service_provider_request_intake','save_service_provider_request_settings','set_service_provider_service_requestable','submit_appointment_request','my_appointment_request','my_appointment_requests','service_provider_appointment_request','service_provider_appointment_requests','service_provider_request_settings','confirm_appointment_request','propose_appointment_request_time','accept_appointment_request_proposal','decline_appointment_request_proposal','withdraw_appointment_request','decline_appointment_request','cancel_requested_appointment_by_owner','cancel_requested_appointment_by_provider','expire_appointment_requests')) loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on function %s from service_role',f.signature);end if;end loop;end $$;
grant execute on function public.service_provider_request_intake(uuid) to anon,authenticated;
grant execute on function public.save_service_provider_request_settings(uuid,uuid,jsonb),public.set_service_provider_service_requestable(uuid,uuid,uuid,boolean),public.submit_appointment_request(uuid,uuid,uuid,text,text,text,jsonb),public.my_appointment_request(uuid),public.my_appointment_requests(timestamptz,uuid),public.service_provider_appointment_request(uuid,uuid),public.service_provider_appointment_requests(uuid,uuid,timestamptz,uuid),public.service_provider_request_settings(uuid,uuid),public.confirm_appointment_request(uuid,timestamptz,timestamptz),public.propose_appointment_request_time(uuid,timestamptz,timestamptz,text),public.accept_appointment_request_proposal(uuid,uuid),public.decline_appointment_request_proposal(uuid,uuid),public.withdraw_appointment_request(uuid),public.decline_appointment_request(uuid,text),public.cancel_requested_appointment_by_owner(uuid),public.cancel_requested_appointment_by_provider(uuid,text) to authenticated;
grant execute on function public.expire_appointment_requests(integer) to pawport_appointment_worker;
-- Existing read models gain request counts and accurate Pawport source labels.

create or replace function public.my_service_provider_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Not authorized';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',o.status,'role',o.role,'locationScope',o.location_scope,
 'teamSummary',case when o.status='active' and o.role in ('owner','admin') then jsonb_build_object('activeMembers',(select count(*) from public.service_provider_memberships where organization_id=o.id and active),'pendingInvitations',(select count(*) from public.service_provider_invitations where organization_id=o.id and status='pending' and expires_at>now())) end,
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'displayName',coalesce(p.display_name,o.name),'profileStatus',coalesce(p.profile_status,'draft'),'publicProfileUrl',case when p.profile_status='published' then '/providers/'||l.id end,'googlePlaceId',l.google_place_id,'newRequestCount',(select count(*) from public.appointment_requests r where r.location_id=l.id and r.status in ('requested','provider_proposed') and r.expires_at>now() and (r.status='requested' or exists(select 1 from public.appointment_request_proposals q where q.id=r.current_proposal_id and q.expires_at<=now()))),'awaitingOwnerCount',(select count(*) from public.appointment_requests r join public.appointment_request_proposals q on q.id=r.current_proposal_id where r.location_id=l.id and r.status='provider_proposed' and r.expires_at>now() and q.status='pending' and q.expires_at>now()),
 'scheduling',jsonb_build_object('connected',coalesce(c.status='active',false),'status',coalesce(c.status,'not_connected'),'system',c.external_system,'availabilitySupported',coalesce(c.status='active' and c.availability_supported and (c.external_system<>'mock' or (select demo_enabled from public.availability_runtime_settings where singleton)),false),'lastSuccessfulSyncAt',c.last_success_at,'hasError',coalesce(c.last_error_code is not null,false))) order by l.id)
 from(select * from public.service_provider_locations where organization_id=o.id and public.service_provider_can_access_location(o.id,id) order by id limit 100)l left join public.service_provider_location_profiles p on p.location_id=l.id
 left join lateral(select status,external_system,availability_supported,last_success_at,last_error_code from public.provider_connections where google_place_id=l.google_place_id order by (status='active') desc,updated_at desc,id limit 1)c on true),'[]'::jsonb)) order by o.name,o.id)
 from(select o.id,o.name,o.status,m.role,m.location_scope from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id where m.user_id=auth.uid() and m.active order by o.name,o.id limit 100)o),'[]'::jsonb);
end $$;

create or replace function public.my_pawport_today(p_zone text default 'UTC') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;today date;
begin
 if auth.uid() is null or not exists(select 1 from public.households where owner_id=auth.uid()) then raise exception 'Not authorized'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then raise exception 'Invalid time zone'; end if;
 today:=(now() at time zone p_zone)::date;
 with owned as(select p.id,p.name from public.pets p join public.households h on h.id=p.household_id where h.owner_id=auth.uid()),care as(
 select cp.*,o.id occurrence_id,coalesce(o.snoozed_until,o.scheduled_for) due,o.snoozed_until,op.name pet_name,(cp.anchor_local_time is null and o.snoozed_until is null) date_only from public.care_plans cp join owned op on op.id=cp.pet_id join public.care_plan_occurrences o on o.plan_id=cp.id and o.status='pending' where cp.status='active'),
 raw as (
 select 'care:'||c.occurrence_id::text id,c.pet_id,c.pet_name,'care_due' kind,'care' category,c.title,'Owner-entered care routine' subtitle,c.due due_at,c.date_only, '/care/plans/'||c.id::text action_url,'care' source_type,null::text trust_state,
 case when c.date_only then case when (c.due at time zone c.time_zone)::date<(now() at time zone c.time_zone)::date then 'overdue' when (c.due at time zone c.time_zone)::date=(now() at time zone c.time_zone)::date then 'today' else 'soon' end
 when c.due<now() then 'overdue' when (c.due at time zone p_zone)::date=today then 'today' else 'soon' end urgency,
 jsonb_build_object('occurrenceId',c.occurrence_id,'timeZone',c.time_zone,'snoozed',c.snoozed_until is not null) metadata
 from care c where (c.due at time zone case when c.date_only then c.time_zone else p_zone end)::date<=case when c.date_only then (now() at time zone c.time_zone)::date else today end+7
 union all
 select 'appointment:'||a.id::text,a.pet_id,p.name,'appointment','appointment',a.title,case when a.source='external' then 'Synced from provider' when a.source='pawport' then 'Confirmed through Pawport' else 'Owner-entered appointment' end,a.starts_at,false,'/appointments/'||a.id::text,'appointment',null,case when (a.starts_at at time zone p_zone)::date=today then 'today' else 'soon' end,jsonb_build_object('timeZone',a.time_zone,'providerName',a.provider_name)
 from public.appointments a join owned p on p.id=a.pet_id where a.status in ('scheduled','confirmed','requested','waitlisted') and coalesce(a.ends_at,a.starts_at+interval '1 hour')>=now() and (a.starts_at at time zone p_zone)::date between today and today+7
 union all
 select 'vaccination-expiration:'||v.id::text,v.pet_id,p.name,'record_expiration','health',v.name||' vaccination record '||case when v.due_on<today then 'expired ' else 'expires ' end||to_char(v.due_on,'Mon DD, YYYY'),null,v.due_on::timestamp at time zone p_zone,true,'/pets/'||p.id::text||'/records','vaccination',case t->>'verification_status' when 'provider_verified' then 'vet_verified' when 'document_supported' then 'document_supported' else 'owner_entered' end,case when v.due_on<today then 'overdue' when v.due_on=today then 'today' else 'info' end,jsonb_build_object('timeZone',p_zone,'recordDate',v.due_on)
 from owned p cross join lateral jsonb_array_elements(public.owner_vaccination_trust(p.id)) t join public.vaccinations v on v.id=(t->>'vaccination_id')::uuid where v.due_on is not null and v.due_on<=today+30
 union all
 select 'verification:'||n.verification_request_id::text,n.subject_pet_id,p.name,'verification_result','notification',n.title,n.body,null,false,n.action_url,'verification','vet_verified','info',jsonb_build_object('notificationId',n.id)
 from public.notifications n join owned p on p.id=n.subject_pet_id join public.verification_requests vr on vr.id=n.verification_request_id and vr.status='verified' where n.user_id=auth.uid() and n.type='verification_update' and n.read_at is null and n.dismissed_at is null
 ), ranked as(select r.*,case when category='care' and urgency='overdue' then 1 when category='care' and urgency='today' then 2 when category='appointment' then 4 when category='notification' then 5 else 6 end priority,case when category in ('care','appointment') and urgency='soon' then 'comingUp' else 'attention' end section from raw r), dto as(select *,jsonb_build_object('id',id,'petId',pet_id,'petName',pet_name,'kind',kind,'category',category,'urgency',urgency,'title',title,'subtitle',subtitle,'dueAt',due_at,'dateOnly',date_only,'actionUrl',action_url,'sourceType',source_type,'trustState',trust_state,'metadata',metadata) item from ranked),
 recent as(select e,op.name pet_name from owned op cross join lateral jsonb_array_elements(public.my_pet_timeline(op.id,'all',null,null,5)->'events') e order by (e->>'occurredAt')::timestamptz desc,e->>'id' collate "C" desc limit 5)
 select jsonb_build_object('attention',coalesce((select jsonb_agg(item order by priority,due_at nulls last,id) from (select * from dto where section='attention' order by priority,due_at nulls last,id limit 10) x),'[]'::jsonb),'comingUp',coalesce((select jsonb_agg(item order by due_at,id) from(select * from dto where section='comingUp' order by due_at,id limit 10)x),'[]'::jsonb),'recentActivity',coalesce((select jsonb_agg(e||jsonb_build_object('petName',pet_name) order by (e->>'occurredAt')::timestamptz desc,e->>'id' collate "C" desc) from recent),'[]'::jsonb),'summary',jsonb_build_object('overdueCount',(select count(*) from raw where category='care' and urgency='overdue'),'dueTodayCount',(select count(*) from raw where category in ('care','appointment') and urgency='today'),'nextSevenDaysCount',(select count(*) from raw where category in ('care','appointment') and urgency in ('today','soon')),'careThisWeek',(select count(*) from raw where category='care' and urgency in ('today','soon')),'appointmentsThisWeek',(select count(*) from raw where category='appointment'),'activeOpeningMatches',0),'hasTrackedData',exists(select 1 from public.care_plans cp join owned o on o.id=cp.pet_id) or exists(select 1 from public.appointments a join owned o on o.id=a.pet_id) or exists(select 1 from public.vaccinations v join owned o on o.id=v.pet_id) or exists(select 1 from recent)) into result;return result;
end $$;

create or replace function public.my_pet_timeline(p_pet uuid,p_filter text default 'all',p_before timestamptz default null,p_before_id text default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.owns_health_pet(p_pet) then raise exception 'Not authorized'; end if;
 if p_filter is null or p_filter not in ('all','health','care','appointments','life') or p_limit is null or p_limit<1 or p_limit>50 or (p_before is null)<>(p_before_id is null) or (p_before is not null and (not isfinite(p_before) or length(p_before_id) not between 1 and 120)) then raise exception 'Invalid timeline query'; end if;
 with events as (
 select 'care:'||o.id::text||':'||o.status id,'care' source_type,o.id source_id,coalesce(o.completed_at,o.skipped_at) occurred_at,'care_'||o.status event_type,o.title_snapshot||' '||o.status title,'Owner-entered care routine' subtitle,o.completion_note description,null::text trust_state,'care' category,'/care/plans/'||p.id::text action_url,null::text photo_url,jsonb_build_object('careCategory',o.category_snapshot,'timeZone',o.time_zone_snapshot) metadata
 from public.care_plans p join public.care_plan_occurrences o on o.plan_id=p.id where p.pet_id=p_pet and o.status in ('completed','skipped') and p_filter in ('all','care')
 union all
 select 'appointment:'||a.id::text||':'||a.status,'appointment',a.id,case when a.status='completed' then coalesce(a.ends_at,a.starts_at) else a.updated_at end,'appointment_'||a.status,a.title||' '||a.status,a.provider_name,case when a.source='external' then 'Synced from provider' when a.source='pawport' then 'Confirmed through Pawport' else 'Owner-entered appointment' end,null,'appointments','/appointments/'||a.id::text,null,jsonb_build_object('appointmentType',a.appointment_type,'timeZone',a.time_zone)
 from public.appointments a where a.pet_id=p_pet and a.status in ('completed','cancelled') and p_filter in ('all','appointments')
 union all
 select 'vaccination:'||v.id::text,'vaccination',v.id,
 case when r.status='verified' then r.verified_at when r.status='pending' then r.requested_at when r.status='revoked' then r.revoked_at else coalesce(d.attached_at,v.created_at) end,
 case when r.status='verified' then 'vaccination_verified' when r.status='pending' then 'verification_requested' when r.status='revoked' then 'verification_revoked' when d.document_id is not null then 'vaccination_documented' else 'vaccination_added' end,
 v.name||case when r.status='verified' then ' vaccination verified' when r.status='pending' then ' submitted for verification' when r.status='revoked' then ' verification revoked' when d.document_id is not null then ' vaccination documented' else ' vaccination added' end,
 null,null,case when r.status='verified' and r.provider_name is not null and r.verified_at is not null then 'vet_verified' when d.document_id is not null then 'document_supported' else 'owner_entered' end,'health','/pets/'||p_pet::text||'/records',null,'{}'::jsonb
 from public.vaccinations v left join lateral(select vd.document_id,vd.attached_at from public.vaccination_documents vd join public.health_documents hd on hd.id=vd.document_id and hd.pet_id=p_pet and hd.uploaded_at is not null where vd.vaccination_id=v.id) d on true
 left join lateral(select vr.status,vr.requested_at,vr.verified_at,vr.revoked_at,vr.provider_name from public.verification_requests vr where vr.vaccination_id=v.id order by vr.requested_at desc,vr.id desc limit 1) r on true
 where v.pet_id=p_pet and p_filter in ('all','health')
 union all
 select 'document:'||d.id::text,'document',d.id,d.uploaded_at,'document_added',d.original_name||' added','Medical document',null,null,'health','/documents/'||d.id::text,null,'{}'::jsonb from public.health_documents d where d.pet_id=p_pet and d.uploaded_at is not null and p_filter in ('all','health')
 union all
 select 'journal:'||j.id::text,'journal',j.id,j.occurred_at,'journal_'||j.entry_type,coalesce(j.title,case when j.entry_type='weight' then j.weight_value::text||' '||j.weight_unit when j.entry_type='photo' then 'A photo' else 'A little piece of their story' end),'Owner added',j.note,null,'life','/pets/'||p_pet::text||'/timeline/'||j.id::text,case when j.photo_id is not null then '/pets/'||p_pet::text||'/timeline/'||j.id::text||'/photo?v='||j.photo_id::text end,jsonb_strip_nulls(jsonb_build_object('entryType',j.entry_type,'weightValue',j.weight_value,'weightUnit',j.weight_unit,'timeZone',j.time_zone)) from public.pet_journal_entries j where j.pet_id=p_pet and j.deleted_at is null and p_filter in ('all','life')
 ), page as (select * from events where occurred_at<=now()+interval '5 minutes' and (p_before is null or (occurred_at,id collate "C")<(p_before,p_before_id collate "C")) order by occurred_at desc,id collate "C" desc limit p_limit+1), numbered as (select *,row_number() over(order by occurred_at desc,id collate "C" desc) n from page)
 select jsonb_build_object('events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sourceType',source_type,'sourceId',source_id,'petId',p_pet,'occurredAt',occurred_at,'eventType',event_type,'title',title,'subtitle',subtitle,'description',description,'trustState',trust_state,'category',category,'actionUrl',action_url,'photoUrl',photo_url,'metadata',metadata) order by n) from numbered where n<=p_limit),'[]'::jsonb),'nextCursor',case when exists(select 1 from numbered where n>p_limit) then (select jsonb_build_object('at',occurred_at,'id',id) from numbered where n=p_limit) else null end) into result;
 return result;
end $$;

commit;
