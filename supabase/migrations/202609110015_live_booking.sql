begin;
-- Operator approval, runtime validation, and business enablement are independent gates.
alter table public.provider_connections add column booking_supported boolean not null default false;
alter table public.provider_connections add column booking_verified_at timestamptz;
alter table public.provider_connections add column booking_validated_at timestamptz;
alter table public.provider_connections add column booking_site_time_zone text;
alter table public.provider_connections add column booking_validation_error text check(booking_validation_error in ('unauthorized','rate_limited','unavailable','vendor_error','unknown'));
alter table public.appointments add column booking_origin text check(booking_origin is null or (booking_origin='pawport_live' and source='external' and external_system='ezyvet'));
-- NULL is an unset cursor, not an invented vendor version; the existing importer already handles it.
alter table public.external_appointment_state alter column external_version drop not null;
create table public.live_booking_runtime_settings(singleton boolean primary key default true check(singleton),sandbox_enabled boolean not null default false);
insert into public.live_booking_runtime_settings(singleton) values(true);
create table public.service_scheduling_bindings (
 id uuid primary key default gen_random_uuid(),service_id uuid not null unique references public.service_provider_services(id),connection_id uuid not null references public.provider_connections(id),
 external_appointment_type_id text not null check(external_appointment_type_id ~ '^appointmentType_[A-Za-z0-9]{21}$'),duration_minutes integer not null check(duration_minutes between 10 and 360 and duration_minutes%5=0),
 resource_mode text not null default 'selected' check(resource_mode in ('all','selected')),live_booking_enabled boolean not null default false,status text not null default 'active' check(status in ('active','paused')),
 configured_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.service_scheduling_resources (
 binding_id uuid not null references public.service_scheduling_bindings(id),external_resource_id text not null check(external_resource_id ~ '^resource_[A-Za-z0-9]{21}$'),display_name text check(length(display_name)<=255),created_at timestamptz not null default now(),primary key(binding_id,external_resource_id)
);
create table public.live_booking_quotes (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),household_id uuid not null references public.households(id),pet_id uuid not null references public.pets(id),service_id uuid not null references public.service_provider_services(id),location_id uuid not null references public.service_provider_locations(id),connection_id uuid not null references public.provider_connections(id),mapping_id uuid not null references public.external_pet_mappings(id),binding_id uuid not null references public.service_scheduling_bindings(id),binding_updated_at timestamptz not null,
 external_appointment_type_id text not null,external_resource_id text not null,starts_at timestamptz not null,ends_at timestamptz not null,time_zone text not null,slot_fingerprint text not null check(slot_fingerprint ~ '^[0-9a-f]{64}$'),
 status text not null default 'available' check(status in ('available','booking','booked','expired','slot_gone','failed','unknown')),expires_at timestamptz not null default now()+interval '5 minutes',created_at timestamptz not null default now(),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at and ends_at-starts_at<=interval '6 hours'),check(isfinite(expires_at) and expires_at<=created_at+interval '5 minutes')
);
create index live_quotes_owner_status on public.live_booking_quotes(user_id,status,expires_at);
create index live_quotes_fingerprint on public.live_booking_quotes(user_id,pet_id,slot_fingerprint);
create table public.live_booking_attempts (
 id uuid primary key default gen_random_uuid(),quote_id uuid not null unique references public.live_booking_quotes(id),user_id uuid not null references auth.users(id),idempotency_key uuid not null unique default gen_random_uuid(),
 status text not null default 'initiated' check(status in ('initiated','availability_reconfirmed','vendor_confirmed','completed','slot_gone','failed','unknown')),external_appointment_id text check(length(external_appointment_id) between 1 and 255),appointment_id uuid unique references public.appointments(id),error_code text check(error_code in ('unauthorized','rate_limited','unavailable','slot_gone','invalid_mapping','vendor_error','unknown')),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index live_attempt_owner_day on public.live_booking_attempts(user_id,created_at);
create table public.live_booking_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),quote_id uuid references public.live_booking_quotes(id),attempt_id uuid references public.live_booking_attempts(id),
 event_type text not null check(event_type in ('availability_requested','catalog_requested','availability_quoted','booking_started','availability_reconfirmed','slot_gone','vendor_confirmed','booking_completed','booking_failed','booking_unknown')),created_at timestamptz not null default now()
);
create index live_event_owner_rate on public.live_booking_events(user_id,event_type,created_at);
do $$ declare t text;begin foreach t in array array['live_booking_runtime_settings','service_scheduling_bindings','service_scheduling_resources','live_booking_quotes','live_booking_attempts','live_booking_events'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,pawport_scheduling_worker',t);if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on public.%I from service_role',t);end if;end loop;end $$;
-- One canonical location predicate for JWT and privileged worker identities.
create function public.lb_user_can_access_location(p_user uuid,p_organization uuid,p_location uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p_user is not null and exists(select 1 from public.service_provider_memberships m join public.service_provider_organizations o on o.id=m.organization_id join public.service_provider_locations l on l.organization_id=o.id where o.id=p_organization and o.status='active' and l.id=p_location and l.status='active' and m.user_id=p_user and m.active and (m.location_scope='all' or exists(select 1 from public.service_provider_membership_locations g where g.membership_id=m.id and g.location_id=l.id)))
$$;
create or replace function public.service_provider_can_access_location(p_organization uuid,p_location uuid) returns boolean language sql stable security definer set search_path='' as $$select public.lb_user_can_access_location(auth.uid(),p_organization,p_location)$$;
create function public.lb_provider_allowed(p_user uuid,p_location uuid,p_connection uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.service_provider_locations l join public.provider_connections c on c.google_place_id=l.google_place_id join public.service_provider_memberships m on m.organization_id=l.organization_id join public.provider_scheduling_permissions sp on sp.connection_id=c.id where l.id=p_location and c.id=p_connection and c.external_system='ezyvet' and m.user_id=p_user and m.active and m.role in ('owner','admin','scheduling_manager') and sp.user_id=p_user and sp.active and sp.role in ('provider_admin','scheduling_manager') and public.lb_user_can_access_location(p_user,l.organization_id,l.id))
$$;
create function public.lb_identity_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_table_name='appointments' then if tg_op='UPDATE' and new.booking_origin is distinct from old.booking_origin and not (old.booking_origin is null and new.booking_origin='pawport_live' and exists(select 1 from public.live_booking_attempts a join public.live_booking_quotes q on q.id=a.quote_id where a.status='vendor_confirmed' and q.connection_id=new.external_connection_id and q.pet_id=new.pet_id and q.user_id=new.created_by and (a.external_appointment_id=new.external_appointment_id or exists(select 1 from public.external_appointment_aliases x where x.connection_id=q.connection_id and x.external_id=a.external_appointment_id and x.canonical_id=new.external_appointment_id)))) then raise exception 'Booking origin immutable';end if;return new;end if;
 if tg_table_name='live_booking_events' then raise exception 'Booking events append-only';end if;
 if tg_table_name='service_scheduling_bindings' then
 if tg_op='UPDATE' and (new.id,new.service_id,new.connection_id,new.created_at) is distinct from (old.id,old.service_id,old.connection_id,old.created_at) then raise exception 'Binding identity immutable';end if;
 if not exists(select 1 from public.service_provider_services s join public.service_provider_locations l on l.id=s.location_id join public.provider_connections c on c.google_place_id=l.google_place_id where s.id=new.service_id and c.id=new.connection_id and c.external_system='ezyvet') then raise exception 'Invalid service connection';end if;return new;end if;
 if tg_table_name='live_booking_quotes' then
 if tg_op='UPDATE' and (to_jsonb(new)-'status') is distinct from (to_jsonb(old)-'status') then raise exception 'Quote identity immutable';end if;
 if not exists(select 1 from public.external_pet_mappings m join public.households h on h.id=m.household_id join public.service_scheduling_bindings b on b.connection_id=m.connection_id join public.service_provider_services s on s.id=b.service_id where m.id=new.mapping_id and h.owner_id=new.user_id and h.id=new.household_id and m.pet_id=new.pet_id and m.connection_id=new.connection_id and b.id=new.binding_id and s.id=new.service_id and s.location_id=new.location_id) then raise exception 'Invalid quote ownership';end if;return new;end if;
 if tg_table_name='live_booking_attempts' then
 if tg_op='UPDATE' and (new.id,new.quote_id,new.user_id,new.idempotency_key,new.created_at) is distinct from (old.id,old.quote_id,old.user_id,old.idempotency_key,old.created_at) then raise exception 'Attempt identity immutable';end if;
 if not exists(select 1 from public.live_booking_quotes where id=new.quote_id and user_id=new.user_id) then raise exception 'Invalid attempt owner';end if;return new;end if;
 return new;end $$;
create trigger live_appointment_origin before update on public.appointments for each row execute function public.lb_identity_guard();
create trigger live_binding_identity before insert or update on public.service_scheduling_bindings for each row execute function public.lb_identity_guard();
create trigger live_quote_identity before insert or update on public.live_booking_quotes for each row execute function public.lb_identity_guard();
create trigger live_attempt_identity before insert or update on public.live_booking_attempts for each row execute function public.lb_identity_guard();
create trigger live_events_append_only before update or delete on public.live_booking_events for each row execute function public.lb_identity_guard();
create function public.set_booking_capability(p_connection uuid,p_supported boolean) returns void language plpgsql security definer set search_path='' as $$begin
 update public.provider_connections set booking_supported=p_supported,booking_verified_at=case when p_supported then now() end where id=p_connection and external_system='ezyvet' and credential_ref ~ '^EZYVET_CONNECTION_[A-Z0-9_]{1,64}$';if not found then raise exception 'Connection unavailable';end if;end $$;
create function public.set_live_booking_sandbox_enabled(p_enabled boolean) returns void language sql security definer set search_path='' as $$update public.live_booking_runtime_settings set sandbox_enabled=p_enabled where singleton$$;
create function public.save_live_booking_binding(p_organization uuid,p_location uuid,p_service uuid,p_connection uuid,p_type text,p_duration integer,p_resources text[],p_enabled boolean,p_status text default 'active') returns uuid language plpgsql security definer set search_path='' as $$declare target uuid;begin
 perform public.ar_authorize(p_location);
 if not exists(select 1 from public.service_provider_locations where id=p_location and organization_id=p_organization) or not public.lb_provider_allowed(auth.uid(),p_location,p_connection) then raise exception 'Explicit integration permission required';end if;
 perform 1 from public.provider_connections where id=p_connection for update;
 if p_resources is null or cardinality(p_resources) not between 1 and 25 or cardinality(p_resources)<>(select count(distinct x) from unnest(p_resources)x) then raise exception 'Select 1 to 25 resources';end if;
 if not exists(select 1 from public.service_provider_services where id=p_service and location_id=p_location and active) then raise exception 'Service unavailable';end if;
 insert into public.service_scheduling_bindings(service_id,connection_id,external_appointment_type_id,duration_minutes,resource_mode,live_booking_enabled,status,configured_by) values(p_service,p_connection,p_type,p_duration,'selected',p_enabled,p_status,auth.uid()) on conflict(service_id) do update set external_appointment_type_id=excluded.external_appointment_type_id,duration_minutes=excluded.duration_minutes,live_booking_enabled=excluded.live_booking_enabled,status=excluded.status,configured_by=auth.uid(),updated_at=now() where service_scheduling_bindings.connection_id=p_connection returning id into target;
 if target is null then raise exception 'Binding connection cannot be reassigned';end if;
 delete from public.service_scheduling_resources where binding_id=target;
 insert into public.service_scheduling_resources(binding_id,external_resource_id) select target,x from unnest(p_resources)x;return target;
end $$;
create function public.lb_rate(p_user uuid,p_kind text) returns void language plpgsql security definer set search_path='' as $$begin
 if p_user is null or p_kind not in ('availability_requested','catalog_requested') then raise exception 'unauthorized';end if;
 perform pg_advisory_xact_lock(hashtextextended('live-rate:'||p_user::text,0));
 if (select count(*) from public.live_booking_events where user_id=p_user and event_type=p_kind and created_at>now()-interval '1 minute')>=20 then raise exception 'rate_limited';end if;
 insert into public.live_booking_events(user_id,event_type) values(p_user,p_kind);
end $$;
create function public.lb_context(p_user uuid,p_location uuid,p_service uuid,p_pet uuid,p_validated boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.service_scheduling_bindings;c public.provider_connections;m public.external_pet_mappings;h uuid;zone text;org uuid;begin
 if p_user is null or not (select sandbox_enabled from public.live_booking_runtime_settings where singleton) then raise exception 'unavailable';end if;
 select l.organization_id into org from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id where l.id=p_location and l.status='active' and o.status='active' for share of l,o;
 select p.time_zone into zone from public.service_provider_location_profiles p where p.location_id=p_location and p.profile_status='published' for share;
 if org is null or zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'unavailable';end if;
 select b0.* into b from public.service_scheduling_bindings b0 join public.service_provider_services s on s.id=b0.service_id where s.id=p_service and s.location_id=p_location and s.active and b0.status='active' and b0.live_booking_enabled and b0.resource_mode='selected' for share of b0,s;
 if b.id is null then raise exception 'unavailable';end if;
 select * into c from public.provider_connections where id=b.connection_id and external_system='ezyvet' and status='active' and availability_supported and booking_supported and credential_ref ~ '^EZYVET_CONNECTION_[A-Z0-9_]{1,64}$' for share;
 if c.id is null or c.google_place_id is distinct from (select google_place_id from public.service_provider_locations where id=p_location) or (p_validated and (c.booking_validated_at is null or c.booking_validated_at<now()-interval '5 minutes' or c.booking_validation_error is not null)) then raise exception 'unavailable';end if;
 select p.household_id into h from public.pets p join public.households hh on hh.id=p.household_id where p.id=p_pet and hh.owner_id=p_user;
 if h is null then raise exception 'invalid_mapping';end if;
 select * into m from public.external_pet_mappings where connection_id=c.id and pet_id=p_pet and household_id=h and match_status='confirmed' and external_pet_id ~ '^animal_[A-Za-z0-9]{1,100}$' and external_owner_id ~ '^contact_[A-Za-z0-9]{1,100}$' order by id limit 1 for share;
 if m.id is null then raise exception 'invalid_mapping';end if;
 if not exists(select 1 from public.service_scheduling_resources where binding_id=b.id) then raise exception 'unavailable';end if;
 return jsonb_build_object('userId',p_user,'householdId',h,'petId',p_pet,'mappingId',m.id,'externalPetId',m.external_pet_id,'externalOwnerId',m.external_owner_id,'connectionId',c.id,'credentialRef',c.credential_ref,'locationId',p_location,'serviceId',p_service,'bindingId',b.id,'bindingUpdatedAt',b.updated_at,'appointmentTypeId',b.external_appointment_type_id,'durationMinutes',b.duration_minutes,'resourceIds',(select jsonb_agg(external_resource_id order by external_resource_id) from public.service_scheduling_resources where binding_id=b.id),'profileTimeZone',zone);
end $$;
create function public.prepare_live_availability_context(p_user uuid,p_location uuid,p_service uuid,p_pet uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin perform public.lb_rate(p_user,'availability_requested');return public.lb_context(p_user,p_location,p_service,p_pet);end $$;
create function public.record_live_connection_validation(p_connection uuid,p_zone text,p_error text default null) returns void language plpgsql security definer set search_path='' as $$begin
 if p_error is null and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then raise exception 'Invalid timezone';end if;
 update public.provider_connections set booking_validated_at=case when p_error is null then now() end,booking_site_time_zone=case when p_error is null then p_zone else booking_site_time_zone end,booking_validation_error=p_error where id=p_connection and external_system='ezyvet';
end $$;
create function public.store_live_booking_quotes(p_user uuid,p_location uuid,p_service uuid,p_pet uuid,p_zone text,p_slots jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;s jsonb;a timestamptz;b timestamptz;resource text;fp text;q public.live_booking_quotes;result jsonb:='[]';begin
 perform pg_advisory_xact_lock(hashtextextended('live-booking:'||p_user::text,0));ctx:=public.lb_context(p_user,p_location,p_service,p_pet,true);
 if p_zone is distinct from (select booking_site_time_zone from public.provider_connections where id=(ctx->>'connectionId')::uuid) then raise exception 'unavailable';end if;
 if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots)>100 then raise exception 'Invalid slots';end if;
 update public.live_booking_quotes set status='expired' where user_id=p_user and status='available' and expires_at<=now();
 for s in select value from jsonb_array_elements(p_slots) loop
 perform public.bp_object(s,array['startsAt','endsAt','resourceId'],1000);a:=(s->>'startsAt')::timestamptz;b:=(s->>'endsAt')::timestamptz;resource:=s->>'resourceId';
 if a is null or b is null or not isfinite(a) or not isfinite(b) or a<=now() or (a at time zone p_zone)::date not between (now() at time zone p_zone)::date and (now() at time zone p_zone)::date+6 or b-a<>make_interval(mins=>(ctx->>'durationMinutes')::integer) or not exists(select 1 from public.service_scheduling_resources where binding_id=(ctx->>'bindingId')::uuid and external_resource_id=resource) then raise exception 'Invalid slot';end if;
 fp:=encode(sha256(convert_to(concat_ws('|',ctx->>'connectionId',ctx->>'appointmentTypeId',resource,extract(epoch from a)::text,extract(epoch from b)::text),'UTF8')),'hex');
 select * into q from public.live_booking_quotes where user_id=p_user and pet_id=p_pet and service_id=p_service and slot_fingerprint=fp and status='available' and expires_at>now() and binding_updated_at=(ctx->>'bindingUpdatedAt')::timestamptz order by created_at desc limit 1;
 if q.id is null then
 if (select count(*) from public.live_booking_quotes where user_id=p_user and status in ('available','booking','unknown'))>=100 then raise exception 'rate_limited';end if;
 insert into public.live_booking_quotes(user_id,household_id,pet_id,service_id,location_id,connection_id,mapping_id,binding_id,binding_updated_at,external_appointment_type_id,external_resource_id,starts_at,ends_at,time_zone,slot_fingerprint)
 values(p_user,(ctx->>'householdId')::uuid,p_pet,p_service,p_location,(ctx->>'connectionId')::uuid,(ctx->>'mappingId')::uuid,(ctx->>'bindingId')::uuid,(ctx->>'bindingUpdatedAt')::timestamptz,ctx->>'appointmentTypeId',resource,a,b,p_zone,fp) returning * into q;
 insert into public.live_booking_events(user_id,quote_id,event_type) values(p_user,q.id,'availability_quoted');end if;
 result:=result||jsonb_build_array(jsonb_build_object('quoteId',q.id,'startsAt',q.starts_at,'endsAt',q.ends_at,'timeZone',q.time_zone,'expiresAt',q.expires_at));
 end loop;return result;
end $$;
create function public.begin_live_booking(p_user uuid,p_quote uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.live_booking_quotes;a public.live_booking_attempts;ctx jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended('live-booking:'||p_user::text,0));
 select * into q from public.live_booking_quotes where id=p_quote and user_id=p_user;
 if q.id is null then raise exception 'unavailable';end if;
 select * into a from public.live_booking_attempts where quote_id=q.id;
 if a.status='vendor_confirmed' then return jsonb_build_object('state','finalize','attemptId',a.id);end if;
 if a.id is not null then return jsonb_build_object('state',case when a.status='completed' then 'completed' when a.status in ('initiated','availability_reconfirmed','vendor_confirmed','unknown') then 'unknown' else a.status end,'appointmentId',a.appointment_id);end if;
 if q.status<>'available' or q.expires_at<=now() then raise exception 'slot_gone';end if;
 ctx:=public.lb_context(p_user,q.location_id,q.service_id,q.pet_id,true);
 perform 1 from public.live_booking_quotes where id=q.id for update;
 if q.binding_updated_at is distinct from (ctx->>'bindingUpdatedAt')::timestamptz or q.mapping_id<>(ctx->>'mappingId')::uuid or q.connection_id<>(ctx->>'connectionId')::uuid or q.external_appointment_type_id<>ctx->>'appointmentTypeId' or not exists(select 1 from public.service_scheduling_resources where binding_id=q.binding_id and external_resource_id=q.external_resource_id) then raise exception 'unavailable';end if;
 -- An uncertain or successful attempt for this pet/time cannot be bypassed by asking for a new quote.
 if exists(select 1 from public.live_booking_attempts x join public.live_booking_quotes y on y.id=x.quote_id where y.user_id=p_user and y.pet_id=q.pet_id and y.connection_id=q.connection_id and y.starts_at=q.starts_at and x.status in ('initiated','availability_reconfirmed','vendor_confirmed','unknown','completed')) then raise exception 'unknown';end if;
 if (select count(*) from public.live_booking_attempts where user_id=p_user and created_at>now()-interval '1 day')>=10 then raise exception 'rate_limited';end if;
 insert into public.live_booking_attempts(quote_id,user_id) values(q.id,p_user) returning * into a;
 update public.live_booking_quotes set status='booking' where id=q.id;
 insert into public.live_booking_events(user_id,quote_id,attempt_id,event_type) values(p_user,q.id,a.id,'booking_started');
 return ctx||jsonb_build_object('state','initiated','attemptId',a.id,'quoteId',q.id,'startsAt',q.starts_at,'endsAt',q.ends_at,'timeZone',q.time_zone,'resourceId',q.external_resource_id);
end $$;
create function public.reconfirm_live_booking(p_attempt uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$declare a public.live_booking_attempts;q public.live_booking_quotes;ctx jsonb;begin
 select * into a from public.live_booking_attempts where id=p_attempt and user_id=p_user;
 select * into q from public.live_booking_quotes where id=a.quote_id;
 if a.id is null then raise exception 'unavailable';end if;
 ctx:=public.lb_context(p_user,q.location_id,q.service_id,q.pet_id,true);
 select * into a from public.live_booking_attempts where id=p_attempt for update;
 if a.status<>'initiated' or q.expires_at<=now() or q.mapping_id is distinct from (ctx->>'mappingId')::uuid or q.connection_id is distinct from (ctx->>'connectionId')::uuid or q.time_zone is distinct from (select booking_site_time_zone from public.provider_connections where id=q.connection_id) or q.binding_updated_at is distinct from (ctx->>'bindingUpdatedAt')::timestamptz then raise exception 'slot_gone';end if;
 update public.live_booking_attempts set status='availability_reconfirmed',updated_at=now() where id=a.id;
 insert into public.live_booking_events(user_id,quote_id,attempt_id,event_type) values(p_user,q.id,a.id,'availability_reconfirmed');
end $$;
create function public.record_live_vendor_confirmation(p_attempt uuid,p_user uuid,p_external_id text) returns void language plpgsql security definer set search_path='' as $$declare a public.live_booking_attempts;begin
 if p_external_id is null or p_external_id !~ '^appointment_[A-Za-z0-9]{1,100}$' then raise exception 'Invalid vendor identity';end if;
 select * into a from public.live_booking_attempts where id=p_attempt and user_id=p_user for update;
 if a.status in ('vendor_confirmed','completed') and a.external_appointment_id=p_external_id then return;end if;
 if a.id is null or a.status<>'availability_reconfirmed' then raise exception 'Invalid booking transition';end if;
 update public.live_booking_attempts set status='vendor_confirmed',external_appointment_id=p_external_id,updated_at=now() where id=a.id;
 insert into public.live_booking_events(user_id,quote_id,attempt_id,event_type) values(p_user,a.quote_id,a.id,'vendor_confirmed');end $$;
create function public.complete_live_booking(p_attempt uuid,p_user uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.live_booking_attempts;q public.live_booking_quotes;s public.external_appointment_state;target uuid;canonical text;begin
 select * into a from public.live_booking_attempts where id=p_attempt and user_id=p_user;
 select * into q from public.live_booking_quotes where id=a.quote_id;
 if a.id is null then raise exception 'unavailable';end if;
 -- Same connection-first lock as import_scheduling_event. Completion must persist a real vendor
 -- success even if the connection was paused or mapping revoked during the HTTP round trip.
 perform 1 from public.provider_connections where id=q.connection_id for update;
 select * into a from public.live_booking_attempts where id=p_attempt for update;
 if a.status='completed' then return a.appointment_id;end if;
 if a.status<>'vendor_confirmed' or a.external_appointment_id is null then raise exception 'Vendor confirmation required';end if;
 select canonical_id into canonical from public.external_appointment_aliases where connection_id=q.connection_id and external_id=a.external_appointment_id;
 canonical:=coalesce(canonical,a.external_appointment_id);
 select * into s from public.external_appointment_state where connection_id=q.connection_id and canonical_id=canonical;
 if s.mapping_id is not null and s.mapping_id<>q.mapping_id then raise exception 'External identity conflict';end if;
 target:=s.appointment_id;
 if target is null then
 insert into public.appointments(household_id,pet_id,created_by,source,external_system,external_connection_id,external_appointment_id,booking_origin,status,sync_state,google_place_id,provider_name,title,appointment_type,starts_at,ends_at,time_zone,location_text)
 select q.household_id,q.pet_id,p_user,'external','ezyvet',q.connection_id,canonical,'pawport_live','confirmed','current',l.google_place_id,o.name,v.name,case v.category when 'emergency_veterinary' then 'emergency_vet' when 'walking' then 'walker' when 'sitting' then 'sitter' when 'retail' then 'other' else v.category end,q.starts_at,q.ends_at,q.time_zone,nullif(left(concat_ws(', ',p.address_line1,p.address_line2,p.city,p.region,p.postal_code,p.country_code),300),'')
 from public.service_provider_services v join public.service_provider_locations l on l.id=v.location_id join public.service_provider_organizations o on o.id=l.organization_id left join public.service_provider_location_profiles p on p.location_id=l.id where v.id=q.service_id returning id into target;
 else
 -- A sync may have arrived before the booking response. Preserve its authoritative current data.
 -- The origin guard permits only this restricted internal path to annotate a previously synced row.
 update public.appointments set booking_origin='pawport_live' where id=target and booking_origin is null;
 end if;
 insert into public.external_appointment_state(connection_id,canonical_id,mapping_id,appointment_id,external_version,tombstoned) values(q.connection_id,canonical,q.mapping_id,target,null,false) on conflict(connection_id,canonical_id) do update set appointment_id=excluded.appointment_id;
 insert into public.external_appointment_aliases(connection_id,external_id,canonical_id) values(q.connection_id,a.external_appointment_id,canonical) on conflict do nothing;
 insert into public.appointment_reminders(appointment_id,user_id,reminder_minutes) values(target,p_user,1440),(target,p_user,120) on conflict do nothing;
 update public.live_booking_attempts set status='completed',appointment_id=target,error_code=null,updated_at=now() where id=a.id;
 update public.live_booking_quotes set status='booked' where id=q.id;
 insert into public.live_booking_events(user_id,quote_id,attempt_id,event_type) values(p_user,q.id,a.id,'booking_completed');return target;
end $$;
create function public.fail_live_booking(p_attempt uuid,p_user uuid,p_code text) returns void language plpgsql security definer set search_path='' as $$declare a public.live_booking_attempts;state text;begin
 if p_code is null or p_code not in ('unauthorized','rate_limited','unavailable','slot_gone','invalid_mapping','vendor_error','unknown') then raise exception 'Invalid error code';end if;
 select * into a from public.live_booking_attempts where id=p_attempt and user_id=p_user for update;
 if a.id is null then raise exception 'unavailable';end if;
 if a.status in ('completed','slot_gone','failed','unknown') then return;end if;
 -- Persisted vendor success is recoverable with complete_live_booking, never another vendor POST.
 if a.status='vendor_confirmed' then return;end if;
 state:=case p_code when 'unknown' then 'unknown' when 'slot_gone' then 'slot_gone' else 'failed' end;
 update public.live_booking_attempts set status=state,error_code=p_code,updated_at=now() where id=a.id;
 update public.live_booking_quotes set status=state where id=a.quote_id;
 insert into public.live_booking_events(user_id,quote_id,attempt_id,event_type) values(p_user,a.quote_id,a.id,case state when 'unknown' then 'booking_unknown' when 'slot_gone' then 'slot_gone' else 'booking_failed' end);
end $$;
create function public.prepare_live_provider_catalog(p_user uuid,p_organization uuid,p_location uuid,p_connection uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not public.lb_provider_allowed(p_user,p_location,p_connection) or not exists(select 1 from public.service_provider_locations where id=p_location and organization_id=p_organization) then raise exception 'unauthorized';end if;
 perform public.lb_rate(p_user,'catalog_requested');
 select jsonb_build_object('connectionId',c.id,'credentialRef',c.credential_ref,'profileTimeZone',p.time_zone) into result from public.provider_connections c join public.service_provider_locations l on l.google_place_id=c.google_place_id left join public.service_provider_location_profiles p on p.location_id=l.id where c.id=p_connection and l.id=p_location and c.status in ('pending','active','error') and c.external_system='ezyvet' and c.credential_ref ~ '^EZYVET_CONNECTION_[A-Z0-9_]{1,64}$';
 if result is null then raise exception 'unavailable';end if;return result;end $$;
-- Only privileged Edge execution sees candidate connection references. It must resolve credentials
-- and validate live catalog + availability before emitting any owner-facing operational claim.
create function public.prepare_live_intake(p_user uuid,p_location uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if p_user is null or not exists(select 1 from auth.users where id=p_user) or not (select sandbox_enabled from public.live_booking_runtime_settings where singleton) then raise exception 'unavailable';end if;
 perform public.lb_rate(p_user,'availability_requested');
 return (select coalesce(jsonb_agg(jsonb_build_object('serviceId',s.id,'name',s.name,'connectionId',c.id,'credentialRef',c.credential_ref,'appointmentTypeId',b.external_appointment_type_id,'durationMinutes',b.duration_minutes,'profileTimeZone',p.time_zone,'resourceIds',(select jsonb_agg(external_resource_id order by external_resource_id) from public.service_scheduling_resources where binding_id=b.id)) order by s.display_order,s.id),'[]'::jsonb)
 from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id join public.service_provider_location_profiles p on p.location_id=l.id join public.service_provider_services s on s.location_id=l.id join public.service_scheduling_bindings b on b.service_id=s.id join public.provider_connections c on c.id=b.connection_id and c.google_place_id=l.google_place_id
 where l.id=p_location and l.status='active' and o.status='active' and p.profile_status='published' and exists(select 1 from pg_catalog.pg_timezone_names where name=p.time_zone) and s.active and b.status='active' and b.live_booking_enabled and b.resource_mode='selected' and exists(select 1 from public.service_scheduling_resources where binding_id=b.id) and c.external_system='ezyvet' and c.status='active' and c.availability_supported and c.booking_supported and exists(select 1 from public.external_pet_mappings m join public.households h on h.id=m.household_id where m.connection_id=c.id and h.owner_id=p_user and m.match_status='confirmed' and m.external_pet_id ~ '^animal_[A-Za-z0-9]{1,100}$' and m.external_owner_id ~ '^contact_[A-Za-z0-9]{1,100}$'));
end $$;
create function public.my_live_booking_configuration(p_organization uuid,p_location uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform public.bp_authorize(p_organization,p_location,false);
 return jsonb_build_object('locationId',p_location,'connections',coalesce((select jsonb_agg(jsonb_build_object('id',case when public.lb_provider_allowed(auth.uid(),p_location,c.id) then c.id end,'system',c.external_system,'status',c.status,'availabilitySupported',c.availability_supported,'bookingSupported',c.booking_supported,'validatedAt',c.booking_validated_at,'timeZone',c.booking_site_time_zone,'hasError',c.booking_validation_error is not null,'canConfigure',public.lb_provider_allowed(auth.uid(),p_location,c.id),'servicesEnabled',(select count(*) from public.service_scheduling_bindings where connection_id=c.id and live_booking_enabled and status='active')) order by c.id) from public.provider_connections c join public.service_provider_locations l on l.google_place_id=c.google_place_id where l.id=p_location and c.external_system='ezyvet'),'[]'::jsonb),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'binding',case when b.id is not null and public.lb_provider_allowed(auth.uid(),p_location,b.connection_id) then jsonb_build_object('connectionId',b.connection_id,'appointmentTypeId',b.external_appointment_type_id,'durationMinutes',b.duration_minutes,'enabled',b.live_booking_enabled,'status',b.status,'resources',(select jsonb_agg(external_resource_id order by external_resource_id) from public.service_scheduling_resources where binding_id=b.id)) end) order by s.display_order,s.id) from public.service_provider_services s left join public.service_scheduling_bindings b on b.service_id=s.id where s.location_id=p_location and s.active),'[]'::jsonb));
end $$;
create function public.lb_connection_credentials_changed() returns trigger language plpgsql set search_path='' as $$begin
 if (new.credential_ref,new.external_system,new.external_account_id,new.external_location_id) is distinct from (old.credential_ref,old.external_system,old.external_account_id,old.external_location_id) then new.booking_supported=false;new.booking_verified_at=null;new.booking_validated_at=null;end if;return new;end $$;
create trigger live_credentials_changed before update on public.provider_connections for each row execute function public.lb_connection_credentials_changed();
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (left(p.proname,3)='lb_' or p.proname in ('set_booking_capability','set_live_booking_sandbox_enabled','save_live_booking_binding','prepare_live_availability_context','record_live_connection_validation','store_live_booking_quotes','begin_live_booking','reconfirm_live_booking','record_live_vendor_confirmation','complete_live_booking','fail_live_booking','prepare_live_provider_catalog','prepare_live_intake','my_live_booking_configuration')) loop
 execute format('revoke all on function %s from public,anon,authenticated,pawport_scheduling_worker',f.signature);
 if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on function %s from service_role',f.signature);
 if f.proname in ('prepare_live_availability_context','record_live_connection_validation','store_live_booking_quotes','begin_live_booking','reconfirm_live_booking','record_live_vendor_confirmation','complete_live_booking','fail_live_booking','prepare_live_provider_catalog','prepare_live_intake') then execute format('grant execute on function %s to service_role',f.signature);end if;end if;
 end loop;end $$;
grant execute on function public.set_booking_capability(uuid,boolean),public.set_live_booking_sandbox_enabled(boolean) to pawport_scheduling_worker;
grant execute on function public.save_live_booking_binding(uuid,uuid,uuid,uuid,text,integer,text[],boolean,text),public.my_live_booking_configuration(uuid,uuid) to authenticated;
commit;
