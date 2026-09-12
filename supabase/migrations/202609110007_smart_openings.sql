begin;
-- Explicit operator opt-in for local demo DBs; never enabled by the migration.
create table public.availability_runtime_settings (
 singleton boolean primary key default true check(singleton), demo_enabled boolean not null default false
);
insert into public.availability_runtime_settings default values;
alter table public.availability_runtime_settings enable row level security;
revoke all on public.availability_runtime_settings from public,anon,authenticated,pawport_scheduling_worker;
alter table public.provider_connections add column availability_supported boolean not null default false;

create table public.availability_watches (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id),
 pet_id uuid not null references public.pets(id), appointment_id uuid references public.appointments(id),
 connection_id uuid not null references public.provider_connections(id), created_by uuid not null references auth.users(id),
 appointment_type text check(appointment_type in ('veterinary','emergency_vet','grooming','boarding','daycare','walker','sitter','training','medication_followup','vaccination','dental','other')),
 external_service_id text check(length(external_service_id) between 1 and 255), external_staff_id text check(length(external_staff_id) between 1 and 255),
 earliest_date date not null, latest_date date not null check(latest_date>=earliest_date),
 earliest_time time, latest_time time, allowed_weekdays smallint[],
 current_appointment_start timestamptz, time_zone text not null check(length(time_zone) between 1 and 100),
 status text not null default 'active' check(status in ('active','matched','paused','expired','cancelled','connection_unavailable')),
 last_checked_at timestamptz,last_match_at timestamptz,
 expires_at timestamptz not null default now()+interval '90 days',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check_error boolean not null default false,
 revision integer not null default 1, process_token uuid, lease_until timestamptz,
 check(isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '90 days'),
 check(latest_date-earliest_date<=90),check(earliest_time is null or latest_time is null or latest_time>=earliest_time),
 check(allowed_weekdays is null or (cardinality(allowed_weekdays) between 1 and 7 and allowed_weekdays <@ array[0,1,2,3,4,5,6]::smallint[] and array_position(allowed_weekdays,null) is null))
);
create index availability_watch_owner on public.availability_watches(household_id,created_at desc);
create index availability_watch_due on public.availability_watches(status,last_checked_at);
create unique index availability_one_open_watch on public.availability_watches(appointment_id) where appointment_id is not null and status not in ('expired','cancelled');
create table public.notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 type text not null check(type='availability_match'),channel text not null default 'in_app' check(channel in ('in_app','email','push')),
 title text not null check(length(title) between 1 and 120),body text not null check(length(body)<=500),
 action_url text check(action_url ~ '^/openings/[a-f0-9-]{36}$'),
 created_at timestamptz not null default now(),read_at timestamptz,dismissed_at timestamptz,
 dedupe_key text not null check(length(dedupe_key)<=200), unique(user_id,dedupe_key)
);
create table public.availability_matches (
 id uuid primary key default gen_random_uuid(),watch_id uuid not null references public.availability_watches(id),
 external_slot_id text not null check(length(external_slot_id) between 1 and 255),
 starts_at timestamptz not null,ends_at timestamptz not null check(ends_at>starts_at),
 detected_at timestamptz not null default now(),first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),
 status text not null default 'available' check(status in ('available','notified','dismissed','unavailable','booked','expired')),
 notification_id uuid unique references public.notifications(id),created_at timestamptz not null default now(),
 unique(watch_id,external_slot_id,starts_at)
);
create index availability_matches_watch on public.availability_matches(watch_id,starts_at);
-- No browser table access: private IDs and processor fields stay behind safe DTO RPCs.
do $$ declare t text; begin foreach t in array array['availability_watches','availability_matches','notifications'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,pawport_scheduling_worker',t);
end loop;end $$;
create function public.availability_connection_ready(p_connection uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.provider_connections c where c.id=p_connection and c.status='active' and c.availability_supported and (c.external_system<>'mock' or (select demo_enabled from public.availability_runtime_settings where singleton)));
$$;
create function public.set_availability_capability(p_connection uuid,p_supported boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_supported and exists(select 1 from public.provider_connections where id=p_connection and external_system='mock') and not (select demo_enabled from public.availability_runtime_settings where singleton) then raise exception 'Demo availability disabled'; end if;
 update public.provider_connections set availability_supported=p_supported where id=p_connection;
 if not found then raise exception 'Connection unavailable'; end if;
end $$;
create function public.guard_availability_watch() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.pets p join public.households h on h.id=p.household_id where p.id=new.pet_id and h.id=new.household_id and h.owner_id=new.created_by) then raise exception 'Invalid watch ownership'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Invalid time zone'; end if;
 if new.earliest_date::timestamp at time zone new.time_zone >= new.expires_at then raise exception 'Watch window starts after expiry'; end if;
 if new.appointment_id is not null and not exists(select 1 from public.appointments a where a.id=new.appointment_id and a.pet_id=new.pet_id and a.household_id=new.household_id and a.source='external' and a.external_connection_id=new.connection_id) then raise exception 'Invalid watch appointment'; end if;
 if tg_op='INSERT' and not exists(select 1 from public.external_pet_mappings m where m.connection_id=new.connection_id and m.pet_id=new.pet_id and m.household_id=new.household_id and m.match_status='confirmed') then raise exception 'Confirmed connection required'; end if;
 if tg_op='UPDATE' and (new.household_id,new.pet_id,new.appointment_id,new.connection_id,new.created_by,new.current_appointment_start,new.created_at) is distinct from (old.household_id,old.pet_id,old.appointment_id,old.connection_id,old.created_by,old.current_appointment_start,old.created_at) then raise exception 'Watch identity immutable'; end if;
 return new;
end $$;
create trigger availability_watch_identity before insert or update on public.availability_watches for each row execute function public.guard_availability_watch();
-- Derived lifecycle is checked on every read and processing transaction, even without a scheduler.
create function public.availability_watch_state(p_watch uuid) returns text language sql stable security definer set search_path='' as $$
 select case when w.status in ('cancelled','expired') then w.status
 when w.expires_at<=now() or w.current_appointment_start<=now() or (now() at time zone w.time_zone)::date>w.latest_date or c.status='revoked'
 or (w.appointment_id is not null and (a.starts_at<=now() or a.status in ('cancelled','completed')))
 or not exists(select 1 from public.external_pet_mappings m where m.connection_id=w.connection_id and m.pet_id=w.pet_id and m.household_id=w.household_id and m.match_status='confirmed') then 'expired'
 when w.status='paused' then 'paused'
 when w.check_error or not public.availability_connection_ready(w.connection_id) then 'connection_unavailable'
 when w.status='connection_unavailable' then 'active' else w.status end
 from public.availability_watches w join public.provider_connections c on c.id=w.connection_id left join public.appointments a on a.id=w.appointment_id where w.id=p_watch;
$$;
create function public.refresh_availability_watch(p_watch uuid) returns text language plpgsql security definer set search_path='' as $$
declare s text;
begin
 s:=public.availability_watch_state(p_watch);
 update public.availability_watches set status=s,process_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=p_watch and status is distinct from s;
 if s in ('expired','cancelled','paused','connection_unavailable') then
 update public.availability_matches set status=case when s in ('expired','cancelled') then 'expired' else 'unavailable' end where watch_id=p_watch and status in ('available','notified');
 end if;
 return s;
end $$;
create function public.save_availability_watch(p_id uuid,p_pet uuid,p_connection uuid,p_appointment uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid; a public.appointments; w public.availability_watches; target uuid; end_date date; zone text; expiry timestamptz; days smallint[];
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('earliest_date','latest_date','earliest_time','latest_time','allowed_weekdays','time_zone','appointment_type','external_service_id','external_staff_id')) then raise exception 'Invalid watch fields'; end if;
 select p.household_id into h from public.pets p join public.households hh on hh.id=p.household_id where p.id=p_pet and hh.owner_id=auth.uid();
 if h is null then raise exception 'Not authorized'; end if;
 perform 1 from public.provider_connections where id=p_connection for update;
 if not public.availability_connection_ready(p_connection) or not exists(select 1 from public.external_pet_mappings where connection_id=p_connection and pet_id=p_pet and household_id=h and match_status='confirmed') then raise exception 'Availability unavailable'; end if;
 if p_appointment is not null then
 select * into a from public.appointments where id=p_appointment and household_id=h and pet_id=p_pet and source='external' and external_connection_id=p_connection and starts_at>now() and status in ('scheduled','confirmed','requested','waitlisted');
 if a.id is null then raise exception 'Invalid appointment'; end if;
 end if;
 zone:=p_data->>'time_zone';end_date:=(p_data->>'latest_date')::date;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Invalid time zone'; end if;
 if (p_data->>'earliest_date')::date<(now() at time zone zone)::date or end_date>(now() at time zone zone)::date+90 then raise exception 'Choose the next 90 days'; end if;
 if p_data->'allowed_weekdays' is not null and p_data->'allowed_weekdays'<>'null'::jsonb then select array_agg(x::smallint) into days from jsonb_array_elements_text(p_data->'allowed_weekdays') x; if days is null then raise exception 'Choose days'; end if; end if;
 if p_id is null then
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,7));
 if (select count(*) from public.availability_watches where created_by=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'Daily watch limit'; end if;
 -- Persist elapsed-time maximum, date-window end and original appointment cutoff.
 expiry:=least(now()+interval '90 days',(end_date+1)::timestamp at time zone zone,a.starts_at);
 insert into public.availability_watches(household_id,pet_id,appointment_id,connection_id,created_by,appointment_type,external_service_id,external_staff_id,earliest_date,latest_date,earliest_time,latest_time,allowed_weekdays,current_appointment_start,time_zone,expires_at)
 values(h,p_pet,p_appointment,p_connection,auth.uid(),coalesce(a.appointment_type,p_data->>'appointment_type'),nullif(p_data->>'external_service_id',''),nullif(p_data->>'external_staff_id',''),(p_data->>'earliest_date')::date,end_date,nullif(p_data->>'earliest_time','')::time,nullif(p_data->>'latest_time','')::time,days,a.starts_at,zone,expiry) returning id into target;
 else
 select * into w from public.availability_watches where id=p_id and household_id=h and pet_id=p_pet and connection_id=p_connection and appointment_id is not distinct from p_appointment for update;
 if w.id is null or public.availability_watch_state(w.id) in ('expired','cancelled') then raise exception 'Watch unavailable'; end if;
 update public.availability_watches set earliest_date=(p_data->>'earliest_date')::date,latest_date=end_date,earliest_time=nullif(p_data->>'earliest_time','')::time,latest_time=nullif(p_data->>'latest_time','')::time,allowed_weekdays=days,time_zone=zone,expires_at=least(w.created_at+interval '90 days',(end_date+1)::timestamp at time zone zone,w.current_appointment_start,a.starts_at),status=case when w.status='paused' then 'paused' else 'active' end,check_error=false,revision=revision+1,process_token=null,lease_until=null,updated_at=now() where id=p_id;
 update public.availability_matches set status='unavailable' where watch_id=p_id and status in ('available','notified');target:=p_id;
 end if;
 return target;
end $$;
create function public.set_availability_watch_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare w public.availability_watches;
begin
 select * into w from public.availability_watches where id=p_id and created_by=auth.uid() for update;
 if w.id is null or p_status is null or p_status not in ('active','paused','cancelled') then raise exception 'Not authorized'; end if;
 if public.refresh_availability_watch(p_id) in ('expired','cancelled') then raise exception 'Watch has ended'; end if;
 if p_status='active' and not public.availability_connection_ready(w.connection_id) then raise exception 'Connection unavailable'; end if;
 update public.availability_watches set status=p_status,revision=revision+1,process_token=null,lease_until=null,updated_at=now() where id=p_id;
 if p_status<>'active' then update public.availability_matches set status=case when p_status='cancelled' then 'expired' else 'unavailable' end where watch_id=p_id and status in ('available','notified'); end if;
end $$;
create function public.guard_opening_notification_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.user_id,new.type,new.channel,new.action_url,new.dedupe_key,new.created_at) is distinct from (old.user_id,old.type,old.channel,old.action_url,old.dedupe_key,old.created_at) then raise exception 'Notification identity immutable'; end if;
 return new;
end $$;
create trigger opening_notification_identity before update on public.notifications for each row execute function public.guard_opening_notification_identity();
create function public.guard_availability_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.notification_id is not null and not exists(select 1 from public.notifications n join public.availability_watches w on w.id=new.watch_id join public.households h on h.id=w.household_id where n.id=new.notification_id and n.user_id=h.owner_id and n.type='availability_match' and n.channel='in_app' and n.action_url='/openings/'||new.watch_id::text) then raise exception 'Invalid notification recipient'; end if;
 if tg_op='UPDATE' and (new.watch_id,new.external_slot_id,new.starts_at) is distinct from (old.watch_id,old.external_slot_id,old.starts_at) then raise exception 'Match identity immutable'; end if;
 return new;
end $$;
create trigger availability_match_identity before insert or update on public.availability_matches for each row execute function public.guard_availability_notification();
create function public.dismiss_availability_match(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare n uuid;
begin
 update public.availability_matches m set status='dismissed' where m.id=p_id and exists(select 1 from public.availability_watches w where w.id=m.watch_id and w.created_by=auth.uid()) returning notification_id into n;
 if not found then raise exception 'Not authorized'; end if;
 update public.notifications set dismissed_at=now(),read_at=coalesce(read_at,now()) where id=n and user_id=auth.uid();
end $$;
create function public.mark_notification_read(p_id uuid,p_dismiss boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.notifications set read_at=coalesce(read_at,now()),dismissed_at=case when p_dismiss then now() else dismissed_at end where id=p_id and user_id=auth.uid();
 if not found then raise exception 'Not authorized'; end if;
end $$;
-- Safe owner payloads omit slot IDs, connection credentials, customer IDs and worker state.
create function public.my_availability_watches() returns jsonb language plpgsql security definer set search_path='' as $$
declare wid uuid; result jsonb;
begin
 for wid in select id from public.availability_watches where created_by=auth.uid() loop perform public.refresh_availability_watch(wid);end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'pet_id',w.pet_id,'pet_name',p.name,'appointment_id',w.appointment_id,'provider_name',c.display_name,'system',c.external_system,'google_place_id',c.google_place_id,'appointment_type',w.appointment_type,'earliest_date',w.earliest_date,'latest_date',w.latest_date,'earliest_time',w.earliest_time,'latest_time',w.latest_time,'allowed_weekdays',w.allowed_weekdays,'current_appointment_start',w.current_appointment_start,'time_zone',w.time_zone,'status',w.status,'expires_at',w.expires_at,'last_checked_at',w.last_checked_at,'last_match_at',w.last_match_at,'matches',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'starts_at',m.starts_at,'ends_at',m.ends_at,'last_seen_at',m.last_seen_at,'status',case when m.status in ('available','notified') and m.starts_at<=now() then 'expired' else m.status end)) from public.availability_matches m where m.watch_id=w.id),'[]'::jsonb)) order by w.created_at desc),'[]'::jsonb) into result from public.availability_watches w join public.pets p on p.id=w.pet_id join public.provider_connections c on c.id=w.connection_id where w.created_by=auth.uid();
 return result;
end $$;
create function public.my_availability_notifications() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'title',n.title,'body',n.body,'action_url',n.action_url,'read_at',n.read_at,'dismissed_at',n.dismissed_at,'created_at',n.created_at,'system',c.external_system) order by n.created_at desc),'[]'::jsonb) from public.notifications n join public.availability_matches m on m.notification_id=n.id join public.availability_watches w on w.id=m.watch_id join public.provider_connections c on c.id=w.connection_id where n.user_id=auth.uid() and n.channel='in_app';
$$;
create function public.availability_appointment_context(p_appointment uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('appointment_id',a.id,'pet_id',a.pet_id,'connection_id',c.id,'system',c.external_system,'provider_name',c.display_name,'title',a.title,'starts_at',a.starts_at)
 from public.appointments a join public.provider_connections c on c.id=a.external_connection_id join public.households h on h.id=a.household_id
 where a.id=p_appointment and h.owner_id=auth.uid() and a.source='external' and a.starts_at>now() and a.status in ('scheduled','confirmed','requested','waitlisted') and public.availability_connection_ready(c.id) and exists(select 1 from public.external_pet_mappings m where m.connection_id=c.id and m.pet_id=a.pet_id and m.household_id=a.household_id and m.match_status='confirmed');
$$;
-- Leased processing: commit uses the token and rechecks lifecycle, so stale work is discarded.
create function public.begin_availability_check(p_watch uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.availability_watches; c public.provider_connections; tok uuid;
begin
 select pc.* into c from public.provider_connections pc join public.availability_watches ww on ww.connection_id=pc.id where ww.id=p_watch for update of pc;
 perform 1 from public.external_pet_mappings m join public.availability_watches ww on ww.connection_id=m.connection_id and ww.pet_id=m.pet_id where ww.id=p_watch for update of m;
 select * into w from public.availability_watches where id=p_watch for update;
 if w.id is null or public.refresh_availability_watch(p_watch) not in ('active','matched','connection_unavailable') or not public.availability_connection_ready(w.connection_id) or w.lease_until>now() then return null; end if;
 tok:=gen_random_uuid();update public.availability_watches set process_token=tok,lease_until=now()+interval '2 minutes',check_error=false,status=case when status='connection_unavailable' then 'active' else status end where id=p_watch;
 return (to_jsonb(w)-'created_by'-'household_id')||jsonb_build_object('process_token',tok,'system',c.external_system,'current_appointment_start',least(w.current_appointment_start,(select starts_at from public.appointments where id=w.appointment_id)));
end $$;
-- SQL repeats matching predicates as defense in depth; worker never supplies a notification recipient.
create function public.complete_availability_check(p_watch uuid,p_token uuid,p_slots jsonb,p_error boolean default false) returns integer language plpgsql security definer set search_path='' as $$
declare w public.availability_watches; c public.provider_connections; item jsonb; local_start timestamp; st timestamptz; en timestamptz; mid uuid; nid uuid; seen uuid[]:='{}'; count_new integer:=0; cutoff timestamptz;
begin
 select pc.* into c from public.provider_connections pc join public.availability_watches ww on ww.connection_id=pc.id where ww.id=p_watch for update of pc;
 perform 1 from public.external_pet_mappings m join public.availability_watches ww on ww.connection_id=m.connection_id and ww.pet_id=m.pet_id where ww.id=p_watch for update of m;
 select * into w from public.availability_watches where id=p_watch for update;
 if w.id is null or p_token is null or w.process_token is distinct from p_token or w.lease_until<=now() or public.refresh_availability_watch(p_watch) not in ('active','matched') then return 0; end if;
 if p_error then
 update public.availability_watches set status='connection_unavailable',check_error=true,last_checked_at=now(),process_token=null,lease_until=null where id=p_watch;
 update public.availability_matches set status='unavailable' where watch_id=p_watch and status in ('available','notified');return 0;
 end if;
 if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots)>100 then raise exception 'Invalid slots'; end if;
 cutoff:=least(w.current_appointment_start,(select starts_at from public.appointments where id=w.appointment_id));
 for item in select value from jsonb_array_elements(p_slots) loop
 if exists(select 1 from jsonb_object_keys(item) k where k not in ('externalSlotId','connectionId','startsAt','endsAt','appointmentType','externalServiceId','externalStaffId','externalResourceId','bookable')) then raise exception 'Invalid slot fields'; end if;
 if item->>'connectionId' is distinct from w.connection_id::text then raise exception 'Connection mismatch'; end if;
 st:=(item->>'startsAt')::timestamptz;en:=(item->>'endsAt')::timestamptz;local_start:=st at time zone w.time_zone;
 if st is null or en is null or not isfinite(st) or not isfinite(en) or en<=st then raise exception 'Invalid slot time'; end if;
 if item->>'bookable' is distinct from 'true' or st<=now() or st>=w.expires_at or (cutoff is not null and st>=cutoff) or local_start::date<w.earliest_date or local_start::date>w.latest_date or (w.earliest_time is not null and local_start::time<w.earliest_time) or (w.latest_time is not null and local_start::time>w.latest_time) or (w.allowed_weekdays is not null and not(extract(dow from local_start)::smallint=any(w.allowed_weekdays))) or (w.appointment_type is not null and item->>'appointmentType' is distinct from w.appointment_type) or (w.external_service_id is not null and item->>'externalServiceId' is distinct from w.external_service_id) or (w.external_staff_id is not null and item->>'externalStaffId' is distinct from w.external_staff_id) then continue; end if;
 insert into public.availability_matches(watch_id,external_slot_id,starts_at,ends_at) values(p_watch,item->>'externalSlotId',st,en) on conflict(watch_id,external_slot_id,starts_at) do update set last_seen_at=now(),ends_at=excluded.ends_at,status=case when availability_matches.status in ('dismissed','booked','expired') then availability_matches.status else 'notified' end returning id,notification_id into mid,nid;
 seen:=array_append(seen,mid);
 if nid is null then
 insert into public.notifications(user_id,type,title,body,action_url,dedupe_key) select h.owner_id,'availability_match',(case when c.external_system='mock' then 'Demo: ' else '' end)||(case when w.appointment_id is null then 'An opening was found' else 'An earlier opening was found' end),'Availability can change quickly. Check with the provider; nothing is reserved.','/openings/'||p_watch::text,'availability:'||p_watch::text||':'||mid::text from public.households h where h.id=w.household_id on conflict(user_id,dedupe_key) do nothing returning id into nid;
 update public.availability_matches set notification_id=nid,status='notified' where id=mid;
 count_new:=count_new+1;
 end if;
 end loop;
 update public.availability_matches set status=case when starts_at<=now() then 'expired' else 'unavailable' end where watch_id=p_watch and status in ('available','notified') and not(id=any(seen));
 update public.availability_watches set last_checked_at=now(),last_match_at=case when cardinality(seen)>0 then now() else last_match_at end,status=case when cardinality(seen)>0 then 'matched' else 'active' end,process_token=null,lease_until=null where id=p_watch;
 return count_new;
end $$;
-- Periodic worker entry can sweep effective expiration without deleting history.
create function public.sweep_availability_watches() returns void language plpgsql security definer set search_path='' as $$
declare wid uuid;begin for wid in select id from public.availability_watches where status not in ('expired','cancelled') loop perform public.refresh_availability_watch(wid);end loop;end $$;
revoke all on function public.guard_opening_notification_identity(),public.availability_connection_ready(uuid),public.set_availability_capability(uuid,boolean),public.guard_availability_watch(),public.availability_watch_state(uuid),public.refresh_availability_watch(uuid),public.save_availability_watch(uuid,uuid,uuid,uuid,jsonb),public.set_availability_watch_status(uuid,text),public.guard_availability_notification(),public.dismiss_availability_match(uuid),public.mark_notification_read(uuid,boolean),public.my_availability_watches(),public.my_availability_notifications(),public.availability_appointment_context(uuid),public.begin_availability_check(uuid),public.complete_availability_check(uuid,uuid,jsonb,boolean),public.sweep_availability_watches() from public,anon,authenticated;
grant execute on function public.save_availability_watch(uuid,uuid,uuid,uuid,jsonb),public.set_availability_watch_status(uuid,text),public.dismiss_availability_match(uuid),public.mark_notification_read(uuid,boolean),public.my_availability_watches(),public.my_availability_notifications(),public.availability_appointment_context(uuid) to authenticated;
grant execute on function public.set_availability_capability(uuid,boolean),public.begin_availability_check(uuid),public.complete_availability_check(uuid,uuid,jsonb,boolean),public.sweep_availability_watches() to pawport_scheduling_worker;
commit;
