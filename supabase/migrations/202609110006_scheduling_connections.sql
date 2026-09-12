begin;
-- A dedicated, non-login worker role. No browser role inherits it.
do $$ begin if not exists(select 1 from pg_roles where rolname='pawport_scheduling_worker') then create role pawport_scheduling_worker nologin noinherit; end if; end $$;
grant usage on schema public to pawport_scheduling_worker;
create table public.provider_connections (
 id uuid primary key default gen_random_uuid(),
 provider_id uuid references public.veterinary_providers(id),
 display_name text not null default 'Provider connection' check(length(btrim(display_name)) between 1 and 120),
 google_place_id text check(google_place_id ~ '^[A-Za-z0-9_-]{1,255}$'),
 connection_type text not null check(connection_type in ('veterinary','grooming','boarding','daycare','training','walking','sitting','other')),
 external_system text not null check(external_system in ('mock','ezyvet','daysmart','gingr','moego')),
 external_account_id text check(length(external_account_id) between 1 and 255),
 external_location_id text check(length(external_location_id) between 1 and 255),
 credential_ref text check(credential_ref ~ '^[A-Za-z0-9_:/.-]{1,200}$'),
 status text not null default 'pending' check(status in ('pending','active','paused','error','revoked')),
 connected_by uuid references auth.users(id) on delete set null,
 connected_at timestamptz,
 last_sync_at timestamptz,
 last_success_at timestamptz,
 last_error_code text check(last_error_code in ('unavailable','unauthorized','rate_limited','invalid_event','mapping_required','conflict')),
 last_error_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(provider_id is not null or google_place_id is not null),
 check(external_system <> 'mock' or credential_ref is null)
);
-- Explicit grants are provisioned by a trusted operator; verifier membership confers nothing.
create table public.provider_scheduling_permissions (
 connection_id uuid not null references public.provider_connections(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('provider_admin','scheduling_manager')),
 active boolean not null default true,
 created_at timestamptz not null default now(), primary key(connection_id,user_id)
);
create table public.external_pet_mappings (
 id uuid primary key default gen_random_uuid(),
 connection_id uuid not null references public.provider_connections(id),
 household_id uuid not null references public.households(id),
 pet_id uuid not null references public.pets(id),
 external_pet_id text not null check(length(external_pet_id) between 1 and 255),
 external_owner_id text check(length(external_owner_id) between 1 and 255),
 match_status text not null default 'pending' check(match_status in ('pending','confirmed','rejected','disconnected')),
 matched_by uuid references auth.users(id) on delete set null, matched_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(connection_id,external_pet_id)
);
create index external_pet_mapping_household on public.external_pet_mappings(household_id,connection_id);
create table public.provider_sync_events (
 id uuid primary key default gen_random_uuid(), connection_id uuid not null references public.provider_connections(id),
 external_event_id text not null check(length(external_event_id) between 1 and 255),
 event_fingerprint text not null,
 event_type text not null check(event_type in ('upsert','tombstone')),
 external_object_type text not null default 'appointment' check(external_object_type='appointment'),
 external_object_id text not null check(length(external_object_id) between 1 and 255),
 received_at timestamptz not null default now(), processed_at timestamptz,
 status text not null default 'received' check(status in ('received','processed','ignored','blocked')),
 error_code text check(error_code in ('mapping_required','conflict')),
 unique(connection_id,external_event_id)
);
-- Private cursor + aliases preserve immutable Phase 5A external identities on vendor replacement.
create table public.external_appointment_state (
 connection_id uuid not null references public.provider_connections(id),
 canonical_id text not null check(length(canonical_id) between 1 and 255),
 mapping_id uuid not null references public.external_pet_mappings(id),
 appointment_id uuid unique references public.appointments(id),
 external_version bigint not null check(external_version>=0),
 tombstoned boolean not null default false,
 primary key(connection_id,canonical_id)
);
create table public.external_appointment_aliases (
 connection_id uuid not null,
 external_id text not null check(length(external_id) between 1 and 255),
 canonical_id text not null,
 primary key(connection_id,external_id),
 foreign key(connection_id,canonical_id) references public.external_appointment_state(connection_id,canonical_id)
);
-- Existing Phase 5A RLS stays byte-for-byte unchanged. This column contains only safe sync state.
alter table public.appointments add column sync_state text check(sync_state in ('current','paused','disconnected','attention'));

do $$ declare t text; begin
 foreach t in array array['provider_connections','provider_scheduling_permissions','external_pet_mappings','provider_sync_events','external_appointment_state','external_appointment_aliases'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,pawport_scheduling_worker',t);
 end loop;
end $$;
-- Only safe DTO functions below expose these tables. No public SELECT, including credential_ref.
create function public.guard_external_mapping() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.pets p where p.id=new.pet_id and p.household_id=new.household_id) then raise exception 'Invalid mapping ownership'; end if;
 if tg_op='UPDATE' and (new.connection_id,new.household_id,new.pet_id,new.external_pet_id,new.external_owner_id) is distinct from (old.connection_id,old.household_id,old.pet_id,old.external_pet_id,old.external_owner_id) then raise exception 'Mapping identity is immutable'; end if;
 if new.match_status='confirmed' and (new.matched_at is null or not exists(select 1 from public.households h where h.id=new.household_id and h.owner_id=new.matched_by)) then raise exception 'Owner confirmation required'; end if;
 return new;
end $$;
create trigger external_mapping_identity before insert or update on public.external_pet_mappings for each row execute function public.guard_external_mapping();

create function public.my_scheduling_connections() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'label',c.display_name,'connection_type',c.connection_type,'system',c.external_system,'status',c.status,'last_sync_at',c.last_sync_at,'last_success_at',c.last_success_at,'last_error_code',c.last_error_code,'can_manage',exists(select 1 from public.provider_scheduling_permissions p where p.connection_id=c.id and p.user_id=auth.uid() and p.active))), '[]'::jsonb)
 from public.provider_connections c where auth.uid() is not null and (
 exists(select 1 from public.provider_scheduling_permissions p where p.connection_id=c.id and p.user_id=auth.uid() and p.active)
 or exists(select 1 from public.external_pet_mappings m join public.households h on h.id=m.household_id where m.connection_id=c.id and h.owner_id=auth.uid()));
$$;
create function public.my_external_pet_mappings() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'connection_id',m.connection_id,'pet_id',m.pet_id,'pet_name',p.name,'status',m.match_status)), '[]'::jsonb)
 from public.external_pet_mappings m join public.households h on h.id=m.household_id join public.pets p on p.id=m.pet_id where h.owner_id=auth.uid();
$$;
create function public.decide_external_pet_mapping(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare m public.external_pet_mappings;
begin
 if auth.uid() is null or p_status not in ('confirmed','rejected','disconnected') then raise exception 'Not authorized'; end if;
 select * into m from public.external_pet_mappings where id=p_id for update;
 if m.id is null or not exists(select 1 from public.households where id=m.household_id and owner_id=auth.uid()) then raise exception 'Not authorized'; end if;
 -- Revoked consent is terminal; reconnection requires a separately reviewed workflow.
 if not ((m.match_status='pending' and p_status in ('confirmed','rejected')) or (m.match_status='confirmed' and p_status='disconnected')) then raise exception 'Invalid transition'; end if;
 update public.external_pet_mappings set match_status=p_status,matched_by=auth.uid(),matched_at=now(),updated_at=now() where id=p_id;
 if p_status='disconnected' then update public.appointments set sync_state='disconnected' where id in (select appointment_id from public.external_appointment_state where mapping_id=p_id); end if;
end $$;
create function public.set_scheduling_connection_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare c public.provider_connections;
begin
 if auth.uid() is null or not exists(select 1 from public.provider_scheduling_permissions where connection_id=p_id and user_id=auth.uid() and active) then raise exception 'Not authorized'; end if;
 select * into c from public.provider_connections where id=p_id for update;
 if not ((p_status='paused' and c.status in ('active','error')) or (p_status='active' and c.status='paused' and c.last_error_code is null) or (p_status='revoked' and c.status<>'revoked')) then raise exception 'Invalid transition'; end if;
 update public.provider_connections set status=p_status,updated_at=now() where id=p_id;
 update public.appointments set sync_state=case p_status when 'active' then 'attention' when 'paused' then 'paused' else 'disconnected' end where external_connection_id=p_id and source='external' and (p_status='revoked' or exists(select 1 from public.external_appointment_state s join public.external_pet_mappings m on m.id=s.mapping_id where s.appointment_id=appointments.id and m.match_status='confirmed'));
end $$;
-- Proposals require a worker that has independently verified the customer/household binding.
-- No owner/provider API accepts arbitrary external IDs or household IDs.
create function public.propose_external_pet_mapping(p_connection uuid,p_pet uuid,p_external_pet text,p_external_owner text) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid; result uuid;
begin
 perform 1 from public.provider_connections where id=p_connection and status in ('pending','active') for update;
 if not found then raise exception 'Connection unavailable'; end if;
 select household_id into h from public.pets where id=p_pet;
 if h is null then raise exception 'Invalid pet'; end if;
 insert into public.external_pet_mappings(connection_id,household_id,pet_id,external_pet_id,external_owner_id) values(p_connection,h,p_pet,p_external_pet,p_external_owner) returning id into result;
 return result;
end $$;
-- All imports are one transaction with a connection lock, event dedupe and per-object version cursor.
create function public.import_scheduling_event(p_connection uuid,p_event jsonb) returns text language plpgsql security definer set search_path='' as $$
declare c public.provider_connections; m public.external_pet_mappings; s public.external_appointment_state;
 eid uuid; canonical text; prior text; ver bigint; target uuid; event_status text; start_time timestamptz;
begin
 select * into c from public.provider_connections where id=p_connection for update;
 if c.id is null or c.status<>'active' then raise exception 'Connection unavailable'; end if;
 if jsonb_typeof(p_event) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_event) k where k not in ('event_id','kind','external_id','replaces_id','external_pet_id','version','title','appointment_type','starts_at','ends_at','status')) then raise exception 'Invalid event'; end if;
 ver:=(p_event->>'version')::bigint;
 if ver is null or ver<0 or length(p_event->>'external_pet_id') not between 1 and 255 then raise exception 'Invalid event'; end if;
 insert into public.provider_sync_events(connection_id,external_event_id,event_type,external_object_id,event_fingerprint) values(p_connection,p_event->>'event_id',p_event->>'kind',p_event->>'external_id',encode(sha256(convert_to(p_event::text,'UTF8')),'hex')) on conflict(connection_id,external_event_id) do nothing returning id into eid;
 if eid is null then
   if exists(select 1 from public.provider_sync_events where connection_id=p_connection and external_event_id=p_event->>'event_id' and event_fingerprint<>encode(sha256(convert_to(p_event::text,'UTF8')),'hex')) then raise exception 'Event ID conflict'; end if;
   select id,status into eid,event_status from public.provider_sync_events where connection_id=p_connection and external_event_id=p_event->>'event_id';
   if event_status<>'blocked' then return 'duplicate'; end if;
 end if;
 update public.provider_connections set last_sync_at=now(),updated_at=now() where id=p_connection;
 select * into m from public.external_pet_mappings where connection_id=p_connection and external_pet_id=p_event->>'external_pet_id' and match_status='confirmed' for update;
 if m.id is null then
   update public.provider_sync_events set status='blocked',error_code='mapping_required' where id=eid;
   return 'mapping_required';
 end if;
 select canonical_id into canonical from public.external_appointment_aliases where connection_id=p_connection and external_id=p_event->>'external_id';
 if p_event->>'replaces_id' is not null then
   select canonical_id into prior from public.external_appointment_aliases where connection_id=p_connection and external_id=p_event->>'replaces_id';
   if prior is null or (canonical is not null and canonical<>prior) then
     update public.provider_sync_events set status='blocked',error_code='conflict' where id=eid; return 'conflict';
   end if;
   canonical:=prior;
 end if;
 canonical:=coalesce(canonical,p_event->>'external_id');
 select * into s from public.external_appointment_state where connection_id=p_connection and canonical_id=canonical;
 if s.mapping_id is not null and s.mapping_id<>m.id then raise exception 'External identity cannot move pets'; end if;
 if s.external_version is not null and ver<=s.external_version then
   update public.provider_sync_events set status='ignored',processed_at=now(),error_code=null where id=eid; return 'out_of_order';
 end if;
 target:=s.appointment_id;
 if p_event->>'kind'='upsert' then
   start_time:=(p_event->>'starts_at')::timestamptz;
   if target is null then
     insert into public.appointments(household_id,pet_id,created_by,source,external_system,external_connection_id,external_appointment_id,title,appointment_type,starts_at,ends_at,time_zone,status,google_place_id,sync_state)
     select m.household_id,m.pet_id,h.owner_id,'external',c.external_system,c.id,canonical,p_event->>'title',p_event->>'appointment_type',start_time,nullif(p_event->>'ends_at','')::timestamptz,'UTC',p_event->>'status',c.google_place_id,'current' from public.households h where h.id=m.household_id returning id into target;
   else
     update public.appointments set title=p_event->>'title',appointment_type=p_event->>'appointment_type',starts_at=start_time,ends_at=nullif(p_event->>'ends_at','')::timestamptz,status=p_event->>'status',sync_state='current',updated_at=now() where id=target;
   end if;
 else
   update public.appointments set status='cancelled',sync_state='current',updated_at=now() where id=target;
 end if;
 insert into public.external_appointment_state(connection_id,canonical_id,mapping_id,appointment_id,external_version,tombstoned) values(p_connection,canonical,m.id,target,ver,p_event->>'kind'='tombstone') on conflict(connection_id,canonical_id) do update set appointment_id=excluded.appointment_id,external_version=excluded.external_version,tombstoned=excluded.tombstoned;
 insert into public.external_appointment_aliases(connection_id,external_id,canonical_id) values(p_connection,p_event->>'external_id',canonical) on conflict do nothing;
 update public.provider_sync_events set status='processed',processed_at=now(),error_code=null where id=eid;
 update public.provider_connections set last_success_at=now(),last_error_code=null,last_error_at=null where id=p_connection;
 return 'processed';
end $$;
create function public.record_scheduling_failure(p_connection uuid,p_code text) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_code is null or p_code not in ('unavailable','unauthorized','rate_limited','invalid_event','conflict') then raise exception 'Invalid error'; end if;
 update public.provider_connections set status='error',last_sync_at=now(),last_error_at=now(),last_error_code=p_code,updated_at=now() where id=p_connection and status in ('active','error');
 update public.appointments set sync_state='attention' where external_connection_id=p_connection and source='external' and exists(select 1 from public.provider_connections where id=p_connection and status='error');
end $$;
create function public.validate_scheduling_connection(p_connection uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.provider_connections set status='active',connected_at=coalesce(connected_at,now()),last_error_code=null,last_error_at=null,updated_at=now() where id=p_connection and status in ('pending','error');
 if not found then raise exception 'Connection cannot reconnect'; end if;
end $$;
create function public.record_scheduling_run(p_connection uuid,p_success boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.provider_connections set last_sync_at=case when p_success then last_sync_at else now() end,last_success_at=case when p_success then now() else last_success_at end,updated_at=now() where id=p_connection and status='active';
 if not found then raise exception 'Connection unavailable'; end if;
end $$;
-- No default public execute grants. Only dedicated worker RPCs can import or propose bindings.
revoke all on function public.guard_external_mapping(),public.my_scheduling_connections(),public.my_external_pet_mappings(),public.decide_external_pet_mapping(uuid,text),public.set_scheduling_connection_status(uuid,text),public.propose_external_pet_mapping(uuid,uuid,text,text),public.import_scheduling_event(uuid,jsonb),public.record_scheduling_failure(uuid,text),public.validate_scheduling_connection(uuid),public.record_scheduling_run(uuid,boolean) from public,anon,authenticated;
grant execute on function public.my_scheduling_connections(),public.my_external_pet_mappings(),public.decide_external_pet_mapping(uuid,text),public.set_scheduling_connection_status(uuid,text) to authenticated;
grant execute on function public.propose_external_pet_mapping(uuid,uuid,text,text),public.import_scheduling_event(uuid,jsonb),public.record_scheduling_failure(uuid,text),public.validate_scheduling_connection(uuid),public.record_scheduling_run(uuid,boolean) to pawport_scheduling_worker;
commit;
