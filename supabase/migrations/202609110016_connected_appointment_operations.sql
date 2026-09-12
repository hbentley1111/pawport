begin;
alter table public.provider_connections add column cancellation_supported boolean not null default false;
alter table public.provider_connections add column reschedule_supported boolean not null default false;
alter table public.provider_connections add column cancellation_verified_at timestamptz;
alter table public.provider_connections add column reschedule_verified_at timestamptz;
alter table public.provider_connections add column appointment_mutation_validated_at timestamptz;
alter table public.provider_connections add column appointment_mutation_error text check(appointment_mutation_error in ('unauthorized','rate_limited','unavailable','slot_gone','invalid_mapping','conflict','vendor_error','unknown','unsupported'));
-- Current PATCH contract does not document schedule/resource mutation fields.
alter table public.provider_connections add constraint reschedule_contract_disabled check(not reschedule_supported);
create table public.live_booking_appointment_links(
 appointment_id uuid primary key references public.appointments(id),attempt_id uuid unique not null references public.live_booking_attempts(id),quote_id uuid not null references public.live_booking_quotes(id),service_id uuid not null references public.service_provider_services(id),binding_id uuid not null references public.service_scheduling_bindings(id),connection_id uuid not null references public.provider_connections(id),mapping_id uuid not null references public.external_pet_mappings(id),created_at timestamptz not null default now()
);
create table public.live_appointment_mutations(
 id uuid primary key default gen_random_uuid(),appointment_id uuid not null references public.appointments(id),user_id uuid not null references auth.users(id),connection_id uuid not null references public.provider_connections(id),mapping_id uuid not null references public.external_pet_mappings(id),operation text not null check(operation in ('cancel','reschedule')),
 status text not null default 'initiated' check(status in ('initiated','availability_reconfirmed','vendor_confirmed','completed','failed','unknown','slot_gone','reconciled')),
 from_starts_at timestamptz not null,from_ends_at timestamptz,expected_updated_at timestamptz not null,expected_version bigint,
 to_starts_at timestamptz,to_ends_at timestamptz,to_resource_id text,
 external_appointment_id text not null,external_numeric_id bigint check(external_numeric_id>0),vendor_modified_at bigint,vendor_cancelled boolean,
 idempotency_key uuid not null unique default gen_random_uuid(),error_code text check(error_code in ('unauthorized','rate_limited','unavailable','slot_gone','invalid_mapping','conflict','vendor_error','unknown','unsupported')),
 dispatch_at timestamptz,reconcile_attempts integer not null default 0 check(reconcile_attempts between 0 and 10),lease_token uuid,lease_until timestamptz,next_check_at timestamptz not null default now(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(operation<>'reschedule' or (to_starts_at is not null and to_ends_at>to_starts_at)),check(isfinite(from_starts_at))
);
create unique index live_mutation_unresolved on public.live_appointment_mutations(appointment_id) where status in ('initiated','availability_reconfirmed','vendor_confirmed','unknown');
create index live_mutation_reconcile on public.live_appointment_mutations(next_check_at,created_at) where status in ('initiated','vendor_confirmed','unknown');
create index live_mutation_user_rate on public.live_appointment_mutations(user_id,created_at);
create table public.live_appointment_mutation_events(id uuid primary key default gen_random_uuid(),mutation_id uuid not null references public.live_appointment_mutations(id),event_type text not null check(event_type in ('cancel_started','cancel_vendor_confirmed','cancel_completed','cancel_failed','cancel_unknown','reschedule_started','reschedule_availability_reconfirmed','reschedule_vendor_confirmed','reschedule_completed','reschedule_slot_gone','reschedule_failed','reschedule_unknown','reconciliation_started','reconciliation_confirmed','reconciliation_unresolved')),created_at timestamptz not null default now());
-- Reserved normalized schema only: no quote-creation/mutation RPC until reschedule semantics are documented.
create table public.live_reschedule_quotes(id uuid primary key default gen_random_uuid(),appointment_id uuid not null references public.appointments(id),user_id uuid not null references auth.users(id),service_id uuid not null references public.service_provider_services(id),connection_id uuid not null references public.provider_connections(id),mapping_id uuid not null references public.external_pet_mappings(id),binding_id uuid not null references public.service_scheduling_bindings(id),external_resource_id text not null,starts_at timestamptz not null,ends_at timestamptz not null,time_zone text not null,fingerprint text not null,status text not null default 'available' check(status in ('available','mutation_started','used','expired','slot_gone')),expires_at timestamptz not null default now()+interval '5 minutes',created_at timestamptz not null default now(),check(ends_at>starts_at and isfinite(starts_at) and isfinite(ends_at)),check(isfinite(expires_at) and expires_at<=created_at+interval '5 minutes'));
create table public.availability_recheck_requests(id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.provider_connections(id),service_id uuid not null references public.service_provider_services(id),reason text not null default 'appointment_cancelled' check(reason='appointment_cancelled'),source_appointment_id uuid references public.appointments(id),window_start timestamptz not null,window_end timestamptz not null,status text not null default 'pending' check(status in ('pending','processing','completed','failed')),available_after timestamptz not null default now(),attempts integer not null default 0 check(attempts between 0 and 10),lease_token uuid,lease_until timestamptz,watch_cursor uuid,created_at timestamptz not null default now(),processed_at timestamptz,check(window_end>window_start),unique(connection_id,service_id,window_start,window_end));
create index live_recheck_due on public.availability_recheck_requests(available_after) where status in ('pending','processing');

create function public.co_immutable() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_table_name in ('live_booking_appointment_links','live_appointment_mutation_events','live_reschedule_quotes') then raise exception 'Connected history immutable';end if;
 if (new.appointment_id,new.user_id,new.connection_id,new.mapping_id,new.operation,new.from_starts_at,new.from_ends_at,new.expected_updated_at,new.expected_version,new.external_appointment_id,new.idempotency_key,new.created_at) is distinct from (old.appointment_id,old.user_id,old.connection_id,old.mapping_id,old.operation,old.from_starts_at,old.from_ends_at,old.expected_updated_at,old.expected_version,old.external_appointment_id,old.idempotency_key,old.created_at) then raise exception 'Mutation identity immutable';end if;return new;end $$;
create trigger connected_link_immutable before update or delete on public.live_booking_appointment_links for each row execute function public.co_immutable();
create trigger connected_event_immutable before update or delete on public.live_appointment_mutation_events for each row execute function public.co_immutable();
create trigger connected_mutation_identity before update on public.live_appointment_mutations for each row execute function public.co_immutable();
create trigger connected_quote_immutable before update or delete on public.live_reschedule_quotes for each row execute function public.co_immutable();
create function public.co_link_booking() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status='completed' and new.appointment_id is not null then
 insert into public.live_booking_appointment_links(appointment_id,attempt_id,quote_id,service_id,binding_id,connection_id,mapping_id)
 select new.appointment_id,new.id,q.id,q.service_id,q.binding_id,q.connection_id,q.mapping_id from public.live_booking_quotes q join public.appointments a on a.id=new.appointment_id where q.id=new.quote_id and a.booking_origin='pawport_live' and a.external_connection_id=q.connection_id and a.pet_id=q.pet_id and a.created_by=q.user_id on conflict do nothing;
 end if;return new;end $$;
create trigger connected_booking_link after insert or update of status on public.live_booking_attempts for each row execute function public.co_link_booking();
insert into public.live_booking_appointment_links(appointment_id,attempt_id,quote_id,service_id,binding_id,connection_id,mapping_id)
select a.id,t.id,q.id,q.service_id,q.binding_id,q.connection_id,q.mapping_id from public.live_booking_attempts t join public.live_booking_quotes q on q.id=t.quote_id join public.appointments a on a.id=t.appointment_id where t.status='completed' and a.booking_origin='pawport_live' and a.external_connection_id=q.connection_id and a.pet_id=q.pet_id and a.created_by=q.user_id on conflict do nothing;
create function public.set_appointment_mutation_capabilities(p_connection uuid,p_cancellation boolean,p_reschedule boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if p_reschedule then raise exception 'unsupported';end if;
 update public.provider_connections set cancellation_supported=p_cancellation,cancellation_verified_at=case when p_cancellation then now() end,reschedule_supported=false,reschedule_verified_at=null,appointment_mutation_validated_at=null where id=p_connection and external_system='ezyvet' and credential_ref ~ '^EZYVET_CONNECTION_[A-Z0-9_]{1,64}$';if not found then raise exception 'unavailable';end if;end $$;
create function public.co_reset_capabilities() returns trigger language plpgsql set search_path='' as $$begin
 if (new.credential_ref,new.external_system,new.external_account_id,new.external_location_id) is distinct from (old.credential_ref,old.external_system,old.external_account_id,old.external_location_id) then new.cancellation_supported=false;new.reschedule_supported=false;new.cancellation_verified_at=null;new.reschedule_verified_at=null;new.appointment_mutation_validated_at=null;end if;return new;end $$;
create trigger connected_credentials_changed before update on public.provider_connections for each row execute function public.co_reset_capabilities();
create function public.co_actor(p_user uuid,p_appointment uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p_user is not null and exists(select 1 from public.appointments a join public.households h on h.id=a.household_id join public.live_booking_appointment_links k on k.appointment_id=a.id join public.service_provider_services s on s.id=k.service_id where a.id=p_appointment and (h.owner_id=p_user or public.lb_provider_allowed(p_user,s.location_id,k.connection_id)))$$;
create function public.prepare_connected_context(p_user uuid,p_appointment uuid,p_reconcile boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.appointments;k public.live_booking_appointment_links;c public.provider_connections;m public.external_pet_mappings;state text;begin
 if not (select sandbox_enabled from public.live_booking_runtime_settings where singleton) or not public.co_actor(p_user,p_appointment) then raise exception 'unavailable';end if;
 select * into k from public.live_booking_appointment_links where appointment_id=p_appointment;
 select * into c from public.provider_connections where id=k.connection_id for share;
 select * into a from public.appointments where id=p_appointment for share;
 select * into m from public.external_pet_mappings where id=k.mapping_id;
 if a.source<>'external' or a.external_system<>'ezyvet' or a.booking_origin is distinct from 'pawport_live' or a.external_connection_id<>k.connection_id or a.external_appointment_id is null or c.external_system<>'ezyvet' or c.credential_ref !~ '^EZYVET_CONNECTION_[A-Z0-9_]{1,64}$' or c.credential_ref is null then raise exception 'unavailable';end if;
 select status into state from public.live_appointment_mutations where appointment_id=a.id and status in ('initiated','availability_reconfirmed','vendor_confirmed','unknown');
 if not p_reconcile and (c.status<>'active' or not c.cancellation_supported or not c.booking_supported or not c.availability_supported or a.sync_state<>'current' or a.status not in ('scheduled','confirmed') or a.starts_at<=now() or m.match_status<>'confirmed' or m.pet_id<>a.pet_id or m.household_id<>a.household_id or m.external_owner_id is null) then raise exception 'unavailable';end if;
 if not p_reconcile and not exists(select 1 from public.service_provider_services s join public.service_provider_locations l on l.id=s.location_id join public.service_provider_organizations o on o.id=l.organization_id where s.id=k.service_id and l.status='active' and o.status='active' and m.connection_id=k.connection_id and exists(select 1 from public.service_scheduling_bindings b where b.id=k.binding_id and b.connection_id=k.connection_id and b.service_id=k.service_id)) then raise exception 'unavailable';end if;
 if p_reconcile and c.status not in ('active','paused','error') then raise exception 'unavailable';end if;
 return jsonb_build_object('appointmentId',a.id,'connectionId',c.id,'credentialRef',c.credential_ref,'mappingId',m.id,'externalAppointmentId',a.external_appointment_id,'externalPetId',m.external_pet_id,'externalOwnerId',m.external_owner_id,'startsAt',a.starts_at,'endsAt',a.ends_at,'updatedAt',a.updated_at,'version',(select external_version from public.external_appointment_state where appointment_id=a.id),'mutationState',state,'canCancel',c.cancellation_supported and c.status='active' and c.booking_supported,'canReschedule',false,'appointmentTypeId',(select external_appointment_type_id from public.service_scheduling_bindings where id=k.binding_id),'durationMinutes',(select duration_minutes from public.service_scheduling_bindings where id=k.binding_id),'resourceIds',(select jsonb_agg(external_resource_id) from public.service_scheduling_resources where binding_id=k.binding_id));
end $$;
create function public.record_appointment_mutation_validation(p_connection uuid,p_error text default null) returns void language plpgsql security definer set search_path='' as $$begin update public.provider_connections set appointment_mutation_validated_at=case when p_error is null then now() end,appointment_mutation_error=p_error where id=p_connection and external_system='ezyvet';end $$;
create function public.begin_connected_cancellation(p_user uuid,p_appointment uuid,p_expected_updated timestamptz,p_numeric_id bigint,p_vendor_modified bigint) returns jsonb language plpgsql security definer set search_path='' as $$declare ctx jsonb;a public.appointments;m public.live_appointment_mutations;begin
 perform pg_advisory_xact_lock(hashtextextended('connected:'||p_appointment::text,0));
 if not public.co_actor(p_user,p_appointment) then raise exception 'unauthorized';end if;
 select * into m from public.live_appointment_mutations where appointment_id=p_appointment and status in ('initiated','availability_reconfirmed','vendor_confirmed','unknown');
 if m.id is not null then return jsonb_build_object('state','unknown');end if;
 ctx:=public.prepare_connected_context(p_user,p_appointment);
 if not exists(select 1 from public.provider_connections where id=(ctx->>'connectionId')::uuid and appointment_mutation_validated_at>now()-interval '5 minutes' and appointment_mutation_error is null and booking_validated_at>now()-interval '5 minutes') then raise exception 'unavailable';end if;
 select * into a from public.appointments where id=p_appointment for update;
 if a.updated_at is distinct from p_expected_updated then raise exception 'conflict';end if;
 perform pg_advisory_xact_lock(hashtextextended('connected-rate:'||p_user::text,0));
 if (select count(*) from public.live_appointment_mutations where user_id=p_user and created_at>now()-interval '1 day')>=10 then raise exception 'rate_limited';end if;
 if p_numeric_id is null or p_numeric_id<=0 or p_vendor_modified is null then raise exception 'Invalid vendor identity';end if;
 insert into public.live_appointment_mutations(appointment_id,user_id,connection_id,mapping_id,operation,from_starts_at,from_ends_at,expected_updated_at,expected_version,external_appointment_id,external_numeric_id,vendor_modified_at) values(a.id,p_user,(ctx->>'connectionId')::uuid,(ctx->>'mappingId')::uuid,'cancel',a.starts_at,a.ends_at,a.updated_at,(ctx->>'version')::bigint,a.external_appointment_id,p_numeric_id,p_vendor_modified) returning * into m;
 insert into public.live_appointment_mutation_events(mutation_id,event_type) values(m.id,'cancel_started');return ctx||jsonb_build_object('mutationId',m.id,'state','initiated');
end $$;
create function public.assert_connected_dispatch(p_user uuid,p_mutation uuid) returns void language plpgsql security definer set search_path='' as $$declare m public.live_appointment_mutations;a public.appointments;ctx jsonb;begin
 select * into m from public.live_appointment_mutations where id=p_mutation and user_id=p_user;
 if m.id is null then raise exception 'unauthorized';end if;
 ctx:=public.prepare_connected_context(p_user,m.appointment_id);
 select * into m from public.live_appointment_mutations where id=p_mutation for update;
 select * into a from public.appointments where id=m.appointment_id for share;
 if m.status<>'initiated' or m.dispatch_at is not null or a.updated_at is distinct from m.expected_updated_at or a.starts_at is distinct from m.from_starts_at or a.ends_at is distinct from m.from_ends_at or (select external_version from public.external_appointment_state where appointment_id=a.id) is distinct from m.expected_version or (ctx->>'mappingId')::uuid<>m.mapping_id then raise exception 'conflict';end if;
 update public.live_appointment_mutations set dispatch_at=now(),next_check_at=now()+interval '2 minutes',updated_at=now() where id=m.id;
end $$;
create function public.record_connected_vendor_confirmation(p_user uuid,p_mutation uuid) returns void language plpgsql security definer set search_path='' as $$declare m public.live_appointment_mutations;begin
 select * into m from public.live_appointment_mutations where id=p_mutation and user_id=p_user for update;
 if m.id is null then raise exception 'unauthorized';end if;if m.status='vendor_confirmed' then return;end if;
 if m.status not in ('initiated','unknown') or m.dispatch_at is null then raise exception 'conflict';end if;
 update public.live_appointment_mutations set status='vendor_confirmed',vendor_cancelled=true,updated_at=now() where id=m.id;
 insert into public.live_appointment_mutation_events(mutation_id,event_type) values(m.id,'cancel_vendor_confirmed');end $$;
create function public.co_enqueue_cancel() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status='cancelled' and old.status is distinct from 'cancelled' and new.booking_origin='pawport_live' then
 insert into public.availability_recheck_requests(connection_id,service_id,source_appointment_id,window_start,window_end)
 select k.connection_id,k.service_id,new.id,date_trunc('day',old.starts_at at time zone 'UTC') at time zone 'UTC',(date_trunc('day',old.starts_at at time zone 'UTC')+interval '1 day') at time zone 'UTC' from public.live_booking_appointment_links k where k.appointment_id=new.id on conflict(connection_id,service_id,window_start,window_end) do update set status='pending',available_after=now()+interval '2 minutes',attempts=0,lease_token=null,lease_until=null,watch_cursor=null,processed_at=null,source_appointment_id=excluded.source_appointment_id;
 end if;return new;end $$;
create trigger connected_cancel_recheck after update of status on public.appointments for each row execute function public.co_enqueue_cancel();
create function public.complete_connected_cancellation(p_user uuid,p_mutation uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare m public.live_appointment_mutations;a public.appointments;begin
 select * into m from public.live_appointment_mutations where id=p_mutation and user_id=p_user;
 if m.id is null then raise exception 'unauthorized';end if;
 perform 1 from public.provider_connections where id=m.connection_id for update;
 select * into m from public.live_appointment_mutations where id=p_mutation for update;
 if m.status in ('completed','reconciled') then return jsonb_build_object('state',m.status,'cancelled',m.vendor_cancelled);end if;
 if m.status<>'vendor_confirmed' or m.vendor_cancelled is distinct from true then raise exception 'Vendor confirmation required';end if;
 select * into a from public.appointments where id=m.appointment_id for update;
 if a.status<>'cancelled' and (a.updated_at is distinct from m.expected_updated_at or (select external_version from public.external_appointment_state where appointment_id=a.id) is distinct from m.expected_version) then
 update public.live_appointment_mutations set status='unknown',error_code='conflict',updated_at=now() where id=m.id;return jsonb_build_object('state','unknown');end if;
 update public.appointments set status='cancelled',sync_state='current' where id=a.id;
 update public.live_appointment_mutations set status='completed',error_code=null,updated_at=now() where id=m.id;
 insert into public.live_appointment_mutation_events(mutation_id,event_type) values(m.id,'cancel_completed');return jsonb_build_object('state','completed','cancelled',true);
end $$;
create function public.fail_connected_mutation(p_user uuid,p_mutation uuid,p_code text) returns void language plpgsql security definer set search_path='' as $$declare m public.live_appointment_mutations;begin
 select * into m from public.live_appointment_mutations where id=p_mutation and user_id=p_user for update;if m.id is null then raise exception 'unauthorized';end if;
 if m.status in ('completed','reconciled','failed','vendor_confirmed') then return;end if;
 update public.live_appointment_mutations set status=case when p_code='unknown' then 'unknown' else 'failed' end,error_code=p_code,updated_at=now() where id=m.id;
 insert into public.live_appointment_mutation_events(mutation_id,event_type) values(m.id,case when p_code='unknown' then 'cancel_unknown' else 'cancel_failed' end);end $$;

-- Leased read-only reconciliation. No browser role can manufacture observations.
create function public.lease_connected_reconciliation(p_user uuid default null,p_appointment uuid default null,p_limit integer default 5) returns jsonb language plpgsql security definer set search_path='' as $$declare m public.live_appointment_mutations;result jsonb:='[]';tok uuid;ctx jsonb;begin
 if p_limit not between 1 and 10 or not (select sandbox_enabled from public.live_booking_runtime_settings where singleton) then raise exception 'unavailable';end if;
 if p_user is not null and (p_appointment is null or not public.co_actor(p_user,p_appointment)) then raise exception 'unauthorized';end if;
 for m in select x.* from public.live_appointment_mutations x join public.provider_connections c on c.id=x.connection_id where x.status in ('initiated','vendor_confirmed','unknown') and x.next_check_at<=now() and x.reconcile_attempts<10 and (x.lease_until is null or x.lease_until<=now()) and c.external_system='ezyvet' and c.status in ('active','paused','error') and (p_appointment is null or x.appointment_id=p_appointment) order by x.created_at limit p_limit for update of x skip locked loop
 tok:=gen_random_uuid();update public.live_appointment_mutations set lease_token=tok,lease_until=now()+interval '2 minutes',reconcile_attempts=reconcile_attempts+1,status='unknown',updated_at=now() where id=m.id;
 insert into public.live_appointment_mutation_events(mutation_id,event_type) values(m.id,'reconciliation_started');
 result:=result||jsonb_build_array(jsonb_build_object('mutationId',m.id,'appointmentId',m.appointment_id,'leaseToken',tok,'credentialRef',(select credential_ref from public.provider_connections where id=m.connection_id),'externalAppointmentId',m.external_appointment_id,'numericId',m.external_numeric_id,'externalPetId',(select external_pet_id from public.external_pet_mappings where id=m.mapping_id),'externalOwnerId',(select external_owner_id from public.external_pet_mappings where id=m.mapping_id),'expectedUpdatedAt',(select updated_at from public.appointments where id=m.appointment_id),'dispatchAt',m.dispatch_at,'vendorModifiedAt',m.vendor_modified_at));end loop;return result;
end $$;
create function public.reconcile_connected_mutation(p_mutation uuid,p_token uuid,p_expected_updated timestamptz,p_active boolean,p_modified bigint) returns jsonb language plpgsql security definer set search_path='' as $$declare m public.live_appointment_mutations;a public.appointments;resolved boolean:=false;begin
 select * into m from public.live_appointment_mutations where id=p_mutation;
 perform 1 from public.provider_connections where id=m.connection_id for update;
 select * into m from public.live_appointment_mutations where id=p_mutation for update;
 if m.id is null or m.lease_token is distinct from p_token or m.lease_until<=now() or m.status<>'unknown' then raise exception 'conflict';end if;
 select * into a from public.appointments where id=m.appointment_id for update;
 -- An unchanged active snapshot is not proof that an in-flight PATCH never executes.
 if a.updated_at is not distinct from p_expected_updated and p_active is false and p_modified>=m.vendor_modified_at then
 update public.appointments set status='cancelled',sync_state='current' where id=a.id;resolved:=true;
 elsif a.updated_at is not distinct from p_expected_updated and p_active is true and m.dispatch_at is null then resolved:=true;
 end if;
 update public.live_appointment_mutations set status=case when resolved then 'reconciled' else 'unknown' end,vendor_cancelled=case when resolved then not p_active else vendor_cancelled end,error_code=case when resolved then null else 'unknown' end,lease_token=null,lease_until=null,next_check_at=now()+interval '5 minutes',updated_at=now() where id=m.id;
 insert into public.live_appointment_mutation_events(mutation_id,event_type) values(m.id,case when resolved then 'reconciliation_confirmed' else 'reconciliation_unresolved' end);
 return jsonb_build_object('state',case when resolved then 'reconciled' else 'unknown' end,'cancelled',case when resolved then not p_active end);
end $$;

-- Restricted live availability processing reuses the existing leased watch/match RPCs.
create function public.prepare_live_watch_check(p_watch uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare w jsonb;ctx jsonb;begin
 if not (select sandbox_enabled from public.live_booking_runtime_settings where singleton) then raise exception 'unavailable';end if;
 select jsonb_build_object('connectionId',c.id,'credentialRef',c.credential_ref,'serviceId',b.service_id,'pawportType',case s.category when 'emergency_veterinary' then 'emergency_vet' when 'walking' then 'walker' when 'sitting' then 'sitter' when 'retail' then 'other' else s.category end,'bindingUpdatedAt',b.updated_at,'appointmentTypeId',b.external_appointment_type_id,'durationMinutes',b.duration_minutes,'resourceIds',(select jsonb_agg(external_resource_id) from public.service_scheduling_resources where binding_id=b.id)) into ctx
 from public.availability_watches aw join public.live_booking_appointment_links k on k.appointment_id=aw.appointment_id and k.connection_id=aw.connection_id join public.service_scheduling_bindings b on b.id=k.binding_id and b.connection_id=k.connection_id and b.service_id=k.service_id join public.provider_connections c on c.id=k.connection_id join public.service_provider_services s on s.id=b.service_id join public.service_provider_locations l on l.id=s.location_id join public.service_provider_organizations o on o.id=l.organization_id
 where aw.id=p_watch and b.status='active' and b.resource_mode='selected' and s.active and l.status='active' and o.status='active' and c.external_system='ezyvet' and c.status='active' and c.availability_supported and c.credential_ref ~ '^EZYVET_CONNECTION_[A-Z0-9_]{1,64}$';
 if ctx is null then return null;end if;
 w:=public.begin_availability_check(p_watch);if w is null then return null;end if;return ctx||jsonb_build_object('watch',w);
end $$;
create function public.complete_live_watch_check(p_watch uuid,p_token uuid,p_binding_updated timestamptz,p_slots jsonb,p_error boolean default false) returns integer language plpgsql security definer set search_path='' as $$begin
 if not (select sandbox_enabled from public.live_booking_runtime_settings where singleton) then raise exception 'unavailable';end if;
 if not exists(select 1 from public.availability_watches w join public.live_booking_appointment_links k on k.appointment_id=w.appointment_id and k.connection_id=w.connection_id join public.service_scheduling_bindings b on b.id=k.binding_id and b.connection_id=k.connection_id and b.service_id=k.service_id join public.service_provider_services s on s.id=b.service_id join public.service_provider_locations l on l.id=s.location_id join public.service_provider_organizations o on o.id=l.organization_id join public.provider_connections c on c.id=k.connection_id where w.id=p_watch and b.updated_at=p_binding_updated and b.status='active' and s.active and l.status='active' and o.status='active' and c.external_system='ezyvet' and c.status='active' and c.availability_supported) then p_error:=true;end if;
 return public.complete_availability_check(p_watch,p_token,case when p_error then '[]'::jsonb else p_slots end,p_error);
end $$;
create function public.lease_live_rechecks(p_limit integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$declare q public.availability_recheck_requests;tok uuid;ids jsonb;more boolean;result jsonb:='[]';begin
 if p_limit not between 1 and 5 or not (select sandbox_enabled from public.live_booking_runtime_settings where singleton) then raise exception 'unavailable';end if;
 for q in select r.* from public.availability_recheck_requests r join public.provider_connections c on c.id=r.connection_id where r.status in ('pending','processing') and r.available_after<=now() and (r.lease_until is null or r.lease_until<=now()) and r.attempts<10 and c.external_system='ezyvet' and c.status='active' and c.availability_supported order by r.created_at limit p_limit for update of r skip locked loop
 tok:=gen_random_uuid();update public.availability_recheck_requests set status='processing',lease_token=tok,lease_until=now()+interval '10 minutes',attempts=attempts+1 where id=q.id;
 select coalesce(jsonb_agg(x.id order by x.id),'[]') into ids from (select w.id from public.availability_watches w join public.live_booking_appointment_links k on k.appointment_id=w.appointment_id where w.connection_id=q.connection_id and k.service_id=q.service_id and w.status in ('active','matched','connection_unavailable') and w.earliest_date<=(q.window_end at time zone w.time_zone)::date and w.latest_date>=(q.window_start at time zone w.time_zone)::date and (q.watch_cursor is null or w.id>q.watch_cursor) order by w.id limit 26)x;
 more:=jsonb_array_length(ids)>25;
 if more then ids:=ids-25;end if;
 result:=result||jsonb_build_array(jsonb_build_object('id',q.id,'token',tok,'watchIds',ids,'more',more,'cursor',case when jsonb_array_length(ids)>0 then ids->>(jsonb_array_length(ids)-1) else q.watch_cursor::text end));end loop;return result;
end $$;
create function public.complete_live_recheck(p_id uuid,p_token uuid,p_cursor uuid,p_more boolean,p_success boolean) returns void language plpgsql security definer set search_path='' as $$begin
 update public.availability_recheck_requests set status=case when p_success and not p_more then 'completed' when attempts>=10 then 'failed' else 'pending' end,watch_cursor=case when p_success then p_cursor else watch_cursor end,processed_at=case when p_success and not p_more then now() end,lease_token=null,lease_until=null,available_after=now()+interval '5 minutes' where id=p_id and lease_token=p_token and lease_until>now() and status='processing';if not found then raise exception 'conflict';end if;end $$;

-- A provider action uses the existing owner Notification Center, never a customer roster.
alter table public.notifications add column live_mutation_id uuid references public.live_appointment_mutations(id);
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in ('availability_match','care_due','appointment_reminder','verification_update','appointment_request_update','appointment_change'));
alter table public.notifications drop constraint notifications_action_url_check;
alter table public.notifications add constraint notifications_action_url_check check(
 (type='availability_match' and action_url ~ '^/openings/[a-f0-9-]{36}$') or (type='care_due' and action_url ~ '^/care/plans/[a-f0-9-]{36}$') or (type in ('appointment_reminder','appointment_change') and action_url ~ '^/appointments/[a-f0-9-]{36}$') or (type='verification_update' and action_url ~ '^/pets/[a-f0-9-]{36}/records$') or (type='appointment_request_update' and action_url ~ '^/appointments/requests/[a-f0-9-]{36}$'));
alter table public.notifications drop constraint owner_notification_references;
alter table public.notifications add constraint owner_notification_references check(
 (type in ('care_due','availability_match') and appointment_reminder_id is null and verification_request_id is null and subject_pet_id is null and appointment_request_id is null and live_mutation_id is null) or
 (type='appointment_reminder' and channel='in_app' and action_url is not null and appointment_reminder_id is not null and verification_request_id is null and subject_pet_id is not null and appointment_request_id is null and live_mutation_id is null) or
 (type='verification_update' and channel='in_app' and action_url is not null and verification_request_id is not null and appointment_reminder_id is null and subject_pet_id is not null and appointment_request_id is null and live_mutation_id is null) or
 (type='appointment_request_update' and channel='in_app' and action_url is not null and appointment_request_id is not null and subject_pet_id is not null and appointment_reminder_id is null and verification_request_id is null and live_mutation_id is null) or
 (type='appointment_change' and channel='in_app' and action_url is not null and live_mutation_id is not null and subject_pet_id is not null and appointment_reminder_id is null and verification_request_id is null and appointment_request_id is null and care_occurrence_id is null));
create function public.co_notification_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' and new.live_mutation_id is distinct from old.live_mutation_id then raise exception 'Notification reference immutable';end if;
 if new.type='appointment_change' and not exists(select 1 from public.live_appointment_mutations m join public.appointments a on a.id=m.appointment_id join public.households h on h.id=a.household_id where m.id=new.live_mutation_id and m.status in ('completed','reconciled') and m.vendor_cancelled and h.owner_id=new.user_id and a.pet_id=new.subject_pet_id and m.user_id<>h.owner_id and new.action_url='/appointments/'||a.id::text and new.dedupe_key='appointment-change:'||m.id::text) then raise exception 'Invalid connected notification';end if;return new;end $$;
create trigger connected_notification_identity before insert or update on public.notifications for each row execute function public.co_notification_guard();
create function public.co_notify_change() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status in ('completed','reconciled') and new.vendor_cancelled then
 insert into public.notifications(user_id,type,title,body,action_url,dedupe_key,subject_pet_id,live_mutation_id)
 select h.owner_id,'appointment_change','Your appointment was cancelled','The provider confirmed the cancellation.','/appointments/'||a.id::text,'appointment-change:'||new.id::text,a.pet_id,new.id from public.appointments a join public.households h on h.id=a.household_id where a.id=new.appointment_id and h.owner_id<>new.user_id on conflict(user_id,dedupe_key) do nothing;
 end if;return new;end $$;
create trigger connected_change_notice after update of status on public.live_appointment_mutations for each row execute function public.co_notify_change();
create function public.my_connected_operation_state(p_appointment uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if not public.co_actor(auth.uid(),p_appointment) then raise exception 'unauthorized';end if;
 return jsonb_build_object('canCancel',false,'canReschedule',false,'mutationState',(select 'unknown' from public.live_appointment_mutations where appointment_id=p_appointment and status in ('initiated','availability_reconfirmed','vendor_confirmed','unknown') limit 1));end $$;
revoke all on function public.my_connected_operation_state(uuid) from public,anon,authenticated;
grant execute on function public.my_connected_operation_state(uuid) to authenticated;
create function public.my_connected_appointments(p_organization uuid,p_location uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform public.bp_authorize(p_organization,p_location,false);
 return (select coalesce(jsonb_agg(jsonb_build_object('appointmentId',x.id,'title',x.title,'petName',x.pet_name,'startsAt',x.starts_at,'timeZone',x.time_zone,'status',x.status,'mutationState',(select 'unknown' from public.live_appointment_mutations where appointment_id=x.id and status in ('initiated','availability_reconfirmed','vendor_confirmed','unknown') limit 1),'canManage',public.lb_provider_allowed(auth.uid(),p_location,x.connection_id)) order by x.starts_at),'[]') from (select a.id,a.title,p.name pet_name,a.starts_at,a.time_zone,a.status,k.connection_id from public.appointments a join public.live_booking_appointment_links k on k.appointment_id=a.id join public.service_provider_services s on s.id=k.service_id join public.pets p on p.id=a.pet_id where s.location_id=p_location and a.starts_at>now()-interval '7 days' order by a.starts_at limit 25)x);
end $$;
-- Safe operational capability summary, separate from profile/integration-management permissions.
alter function public.my_live_booking_configuration(uuid,uuid) rename to co_live_configuration_8b;
revoke all on function public.co_live_configuration_8b(uuid,uuid) from public,anon,authenticated;
create function public.my_live_booking_configuration(p_organization uuid,p_location uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 result:=public.co_live_configuration_8b(p_organization,p_location);
 return result||jsonb_build_object('connectedOperations',jsonb_build_object('cancellationSupported',exists(select 1 from public.provider_connections c join public.service_provider_locations l on l.google_place_id=c.google_place_id where l.id=p_location and c.external_system='ezyvet' and c.status='active' and c.cancellation_supported),'rescheduleSupported',false));end $$;
revoke all on function public.my_live_booking_configuration(uuid,uuid),public.my_connected_appointments(uuid,uuid) from public,anon,authenticated;
grant execute on function public.my_live_booking_configuration(uuid,uuid),public.my_connected_appointments(uuid,uuid) to authenticated;

do $$declare t text;begin foreach t in array array['live_booking_appointment_links','live_appointment_mutations','live_appointment_mutation_events','live_reschedule_quotes','availability_recheck_requests'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,pawport_scheduling_worker',t);if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on public.%I from service_role',t);end if;end loop;end $$;
do $$declare f record;begin for f in select p.oid::regprocedure sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (left(p.proname,3)='co_' or p.proname in ('set_appointment_mutation_capabilities','prepare_connected_context','record_appointment_mutation_validation','begin_connected_cancellation','assert_connected_dispatch','record_connected_vendor_confirmation','complete_connected_cancellation','fail_connected_mutation','lease_connected_reconciliation','reconcile_connected_mutation')) loop
 execute format('revoke all on function %s from public,anon,authenticated,pawport_scheduling_worker',f.sig);
 if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on function %s from service_role',f.sig);if left(f.proname,3)<>'co_' and f.proname<>'set_appointment_mutation_capabilities' then execute format('grant execute on function %s to service_role',f.sig);end if;end if;end loop;end $$;
grant execute on function public.set_appointment_mutation_capabilities(uuid,boolean,boolean) to pawport_scheduling_worker;
revoke all on function public.prepare_live_watch_check(uuid),public.complete_live_watch_check(uuid,uuid,timestamptz,jsonb,boolean),public.lease_live_rechecks(integer),public.complete_live_recheck(uuid,uuid,uuid,boolean,boolean) from public,anon,authenticated,pawport_scheduling_worker;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.prepare_live_watch_check(uuid),public.complete_live_watch_check(uuid,uuid,timestamptz,jsonb,boolean),public.lease_live_rechecks(integer),public.complete_live_recheck(uuid,uuid,uuid,boolean,boolean) to service_role;end if;end $$;
commit;
