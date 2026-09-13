begin;
-- Commercial authorization is additional to feature-specific scheduling authority.
alter table public.partner_organizations
 add column legal_name text check(length(legal_name)<=160),
 add column external_reference text check(length(external_reference)<=256),
 add column contract_status text not null default 'none' check(contract_status in ('none','evaluation','negotiating','executed','suspended','terminated')),
 add column contract_effective_on date check(contract_effective_on between date '2000-01-01' and date '2200-12-31'),
 add column contract_expires_on date check(contract_expires_on between date '2000-01-01' and date '2200-12-31'),
 add column technical_owner_name text check(length(technical_owner_name)<=160),
 add column technical_owner_email text check(length(technical_owner_email)<=254 and technical_owner_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 add column support_email text check(length(support_email)<=254 and support_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 add column security_contact_email text check(length(security_contact_email)<=254 and security_contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 add column privacy_contact_email text check(length(privacy_contact_email)<=254 and privacy_contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 add column notes text check(length(notes)<=2000),
 add constraint partner_contract_dates check(contract_expires_on>=contract_effective_on);
alter table public.partner_connections
 add column environment text not null default 'sandbox' check(environment in ('sandbox','production')),
 add column runtime_enabled boolean not null default false,
 add column credential_configured_at timestamptz,
 add column last_validated_at timestamptz,
 add column last_validation_status text check(last_validation_status in ('success','failed','unknown')),
 add column last_validation_error text check(last_validation_error in ('unsupported','credentials_missing','invalid_configuration','unavailable','unknown')),
 add column paused_at timestamptz,
 add column pause_reason text check(length(pause_reason)<=500),
 add column activated_at timestamptz,
 add column production_approved_at timestamptz,
 add column production_requested_at timestamptz;

create table public.partner_operator_memberships(user_id uuid primary key references auth.users(id),role text not null check(role in ('operator','admin')),active boolean not null default true,created_at timestamptz not null default now());

create table public.partner_runtime_settings(id boolean primary key default true check(id),sandbox_enabled boolean not null default false,production_enabled boolean not null default false);
insert into public.partner_runtime_settings(id) values(true);

create table public.partner_capabilities(id uuid primary key default gen_random_uuid(),partner_id uuid not null references public.partner_organizations(id),capability_key text not null check(capability_key in ('scheduling.catalog.read','scheduling.availability.read','scheduling.appointment.read','scheduling.appointment.book','scheduling.appointment.cancel','partner.health.readiness','webhook.receive')),environment text not null check(environment in ('sandbox','production')),status text not null default 'requested' check(status in ('requested','approved','paused','revoked')),approved_by text check(length(approved_by)<=160),approved_at timestamptz,expires_at timestamptz check(isfinite(expires_at)),notes text check(length(notes)<=2000),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(partner_id,capability_key,environment));

create table public.partner_connection_activation_events(id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.partner_connections(id),actor text not null check(length(actor)<=160),event_type text not null check(event_type in ('connection_created','sandbox_enabled','sandbox_disabled','credentials_registered','validation_succeeded','validation_failed','production_requested','production_approved','production_enabled','production_paused','production_disabled','connection_revoked')),reason text check(length(reason)<=500),created_at timestamptz not null default now());

create table public.partner_data_grants(id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.partner_connections(id),household_id uuid references public.households(id),organization_id uuid references public.service_provider_organizations(id),location_id uuid references public.service_provider_locations(id),grantor_user_id uuid references auth.users(id),data_category text not null check(data_category in ('pet_identity','owner_contact','appointment_data')),purpose text not null check(purpose in ('scheduling','integration_setup')),direction text not null check(direction in ('pawport_to_partner','partner_to_pawport','bidirectional')),status text not null default 'active' check(status in ('active','revoked','expired')),granted_at timestamptz not null default now(),expires_at timestamptz check(isfinite(expires_at)),revoked_at timestamptz,created_at timestamptz not null default now(),check((household_id is not null)::int+(organization_id is not null)::int=1),check(location_id is null or organization_id is not null));
create index partner_grant_lookup on public.partner_data_grants(connection_id,data_category,status);

create table public.partner_integration_events(id uuid primary key default gen_random_uuid(),connection_id uuid not null references public.partner_connections(id),direction text not null check(direction in ('inbound','outbound')),event_type text not null check(event_type in ('readiness_check','catalog_refresh','availability_refresh','appointment_read','appointment_book','appointment_cancel','webhook_received')),external_event_id text check(length(external_event_id) between 1 and 256),correlation_id uuid not null default gen_random_uuid(),idempotency_key text check(length(idempotency_key) between 1 and 256),status text not null default 'pending' check(status in ('received','pending','processing','completed','failed','dead_letter','unknown')),attempt_count integer not null default 0 check(attempt_count between 0 and 10),available_after timestamptz not null default now(),lease_token uuid,lease_until timestamptz,http_status integer check(http_status between 100 and 599),error_code text check(error_code in ('unauthorized','rate_limited','unavailable','unsupported','invalid_configuration','vendor_error','unknown')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,check(external_event_id is not null or idempotency_key is not null),check((status='processing')=(lease_token is not null and lease_until is not null)));
create unique index partner_external_event_unique on public.partner_integration_events(connection_id,direction,external_event_id) where external_event_id is not null;
create unique index partner_idempotency_unique on public.partner_integration_events(connection_id,idempotency_key) where idempotency_key is not null;
create index partner_event_queue on public.partner_integration_events(status,available_after,created_at);
create index partner_event_history on public.partner_integration_events(connection_id,created_at desc);

create table public.partner_operator_audit_events(id uuid primary key default gen_random_uuid(),actor_user_id uuid references auth.users(id),partner_id uuid references public.partner_organizations(id),connection_id uuid references public.partner_connections(id),event_type text not null check(event_type in ('partner_registered','contract_updated','capability_changed','connection_created','credentials_registered','validation_recorded','production_requested','production_approved','runtime_changed','partner_paused','capability_paused','grant_changed','pilot_updated','bridge_created','operator_provisioned')),metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object' and metadata - array['capability_key','environment','from_status','to_status','reason']='{}'::jsonb and octet_length(metadata::text)<=2000),created_at timestamptz not null default now());

create table public.partner_pilot_sites(id uuid primary key default gen_random_uuid(),partner_id uuid not null references public.partner_organizations(id),connection_id uuid references public.partner_connections(id),organization_id uuid references public.service_provider_organizations(id),location_id uuid references public.service_provider_locations(id),external_site_reference text check(length(external_site_reference)<=256),status text not null default 'candidate' check(status in ('candidate','contacted','consented','credentials_pending','ready','active','completed','withdrawn','failed')),consent_received_at timestamptz check(isfinite(consent_received_at)),pilot_started_at timestamptz check(isfinite(pilot_started_at)),pilot_ends_at timestamptz check(isfinite(pilot_ends_at)),completed_at timestamptz check(isfinite(completed_at)),notes text check(length(notes)<=2000),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(pilot_ends_at>=pilot_started_at),check(status not in ('consented','credentials_pending','ready','active','completed') or consent_received_at is not null));

create table public.partner_provider_connection_links(partner_connection_id uuid primary key references public.partner_connections(id),provider_connection_id uuid unique not null references public.provider_connections(id),created_at timestamptz not null default now());
do $$begin if not exists(select 1 from pg_roles where rolname='pawport_partner_worker') then create role pawport_partner_worker nologin noinherit;
end if;
end $$;
grant usage on schema public to pawport_partner_worker;

create function public.pa_operator(p_admin boolean default false) returns text language plpgsql stable security definer set search_path='' as $$declare r text;
begin select role into r from public.partner_operator_memberships where user_id=auth.uid() and active;
if r is null or (p_admin and r<>'admin') then raise exception 'Operator access required';
end if;
return r;
end $$;

create function public.pa_audit(p_partner uuid,p_connection uuid,p_event text,p_metadata jsonb default '{}') returns void language sql security definer set search_path='' as $$insert into public.partner_operator_audit_events(actor_user_id,partner_id,connection_id,event_type,metadata) values(auth.uid(),p_partner,p_connection,p_event,p_metadata)$$;

create function public.bootstrap_partner_operator(p_user uuid,p_role text,p_active boolean default true) returns void language plpgsql security definer set search_path='' as $$begin insert into public.partner_operator_memberships(user_id,role,active) values(p_user,p_role,p_active) on conflict(user_id) do update set role=excluded.role,active=excluded.active;
perform public.pa_audit(null,null,'operator_provisioned');
end $$;

create function public.pa_append_only() returns trigger language plpgsql set search_path='' as $$begin raise exception 'History is append-only';
end $$;
create trigger partner_activation_append before update or delete on public.partner_connection_activation_events for each row execute function public.pa_append_only();
create trigger partner_audit_append before update or delete on public.partner_operator_audit_events for each row execute function public.pa_append_only();

create function public.pa_activation(p_connection uuid,p_event text,p_reason text default null) returns void language sql security definer set search_path='' as $$insert into public.partner_connection_activation_events(connection_id,actor,event_type,reason) values(p_connection,coalesce(auth.uid()::text,'trusted worker'),p_event,p_reason)$$;

create function public.pa_scope_integrity() returns trigger language plpgsql security definer set search_path='' as $$declare c public.partner_connections;
begin
 select * into c from public.partner_connections where id=new.connection_id;
 if c.id is null then raise exception 'Connection unavailable';
end if;
 if tg_table_name='partner_data_grants' then
 if (new.household_id,new.organization_id,new.location_id) is distinct from (c.household_id,c.organization_id,c.location_id) then raise exception 'Grant scope mismatch';
end if;
 if new.household_id is not null and not exists(select 1 from public.households where id=new.household_id and owner_id=new.grantor_user_id) then raise exception 'Owner grant required';
end if;
 if tg_op='UPDATE' and (new.connection_id,new.household_id,new.organization_id,new.location_id,new.grantor_user_id,new.data_category,new.purpose,new.direction,new.created_at) is distinct from (old.connection_id,old.household_id,old.organization_id,old.location_id,old.grantor_user_id,old.data_category,old.purpose,old.direction,old.created_at) then raise exception 'Grant identity immutable';
end if;
 end if;
return new;
end $$;
create trigger partner_grant_integrity before insert or update on public.partner_data_grants for each row execute function public.pa_scope_integrity();

create function public.pa_connection_integrity() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' then
 if (new.partner_id,new.organization_id,new.location_id,new.household_id,new.environment,new.connection_type,new.created_at) is distinct from (old.partner_id,old.organization_id,old.location_id,old.household_id,old.environment,old.connection_type,old.created_at) then raise exception 'Connection identity immutable';
end if;
 if new.credential_ref is distinct from old.credential_ref then new.credential_configured_at:=null;
new.last_validated_at:=null;
new.last_validation_status:=null;
new.production_approved_at:=null;
new.runtime_enabled:=false;
end if;
 end if;
 if new.runtime_enabled and (new.status<>'active' or not public.pa_ready(new.id,new.partner_id,new.environment,new.credential_ref,new.credential_configured_at,new.last_validated_at,new.last_validation_status,new.production_approved_at)) then raise exception 'Activation prerequisites missing';
end if;
return new;
end $$;

create function public.pa_ready(p_id uuid,p_partner uuid,p_env text,p_ref text,p_configured timestamptz,p_validated timestamptz,p_validation text,p_approved timestamptz) returns boolean language sql stable security definer set search_path='' as $$select coalesce(p_ref is not null and p_configured is not null and p_validation='success' and p_validated>now()-interval '24 hours' and p_validated>=p_configured and exists(select 1 from public.partner_runtime_settings where case when p_env='production' then production_enabled else sandbox_enabled end) and exists(select 1 from public.partner_organizations p where p.id=p_partner and p.status in ('sandbox','active') and (p_env='sandbox' or (p.status='active' and p.contract_status='executed' and (p.contract_effective_on is null or p.contract_effective_on<=current_date) and (p.contract_expires_on is null or p.contract_expires_on>=current_date) and p_approved is not null))) and exists(select 1 from public.partner_capabilities where partner_id=p_partner and environment=p_env and status='approved' and (expires_at is null or expires_at>now())),false)$$;
create trigger partner_connection_guard before insert or update on public.partner_connections for each row execute function public.pa_connection_integrity();

create function public.pa_capability_integrity() returns trigger language plpgsql security definer set search_path='' as $$begin if new.environment='production' and new.status='approved' and not exists(select 1 from public.partner_organizations where id=new.partner_id and contract_status='executed') then raise exception 'Executed contract required';
end if;
return new;
end $$;
create trigger partner_capability_guard before insert or update on public.partner_capabilities for each row execute function public.pa_capability_integrity();

create function public.save_partner_registry(p_partner uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid;
begin perform public.pa_operator(true);
perform public.ins_object(p_data,array['partner_key','display_name','partner_type','legal_name','external_reference','contract_status','contract_effective_on','contract_expires_on','technical_owner_name','technical_owner_email','support_email','security_contact_email','privacy_contact_email','notes']);
 if p_partner is null then insert into public.partner_organizations(partner_key,display_name,partner_type,status) values(p_data->>'partner_key',p_data->>'display_name',p_data->>'partner_type','candidate') returning partner_organizations.id into v_id;
perform public.pa_audit(v_id,null,'partner_registered');
else select p.id into v_id from public.partner_organizations p where p.id=p_partner for update;
if v_id is null then raise exception 'Partner unavailable';
end if;
end if;
 update public.partner_organizations set display_name=p_data->>'display_name',legal_name=p_data->>'legal_name',external_reference=p_data->>'external_reference',contract_status=coalesce(p_data->>'contract_status','none'),contract_effective_on=public.ins_date(p_data->>'contract_effective_on'),contract_expires_on=public.ins_date(p_data->>'contract_expires_on'),technical_owner_name=p_data->>'technical_owner_name',technical_owner_email=nullif(lower(btrim(p_data->>'technical_owner_email')),''),support_email=nullif(lower(btrim(p_data->>'support_email')),''),security_contact_email=nullif(lower(btrim(p_data->>'security_contact_email')),''),privacy_contact_email=nullif(lower(btrim(p_data->>'privacy_contact_email')),''),notes=p_data->>'notes',updated_at=now() where partner_organizations.id=v_id;
perform public.pa_audit(v_id,null,'contract_updated');
return v_id;
end $$;

create function public.set_partner_capability(p_partner uuid,p_key text,p_environment text,p_status text,p_expires timestamptz default null) returns void language plpgsql security definer set search_path='' as $$begin perform public.pa_operator(true);
perform 1 from public.partner_organizations where id=p_partner for update;
insert into public.partner_capabilities(partner_id,capability_key,environment,status,approved_by,approved_at,expires_at) values(p_partner,p_key,p_environment,p_status,auth.uid()::text,case when p_status='approved' then now() end,p_expires) on conflict(partner_id,capability_key,environment) do update set status=excluded.status,approved_by=excluded.approved_by,approved_at=excluded.approved_at,expires_at=excluded.expires_at,updated_at=now();
perform public.pa_audit(p_partner,null,'capability_changed',jsonb_build_object('capability_key',p_key,'environment',p_environment,'to_status',p_status));
end $$;

create function public.create_partner_operational_connection(p_partner uuid,p_org uuid,p_location uuid,p_household uuid,p_environment text default 'sandbox') returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid;
begin perform public.pa_operator(true);
if p_environment not in ('sandbox','production') then raise exception 'Invalid environment';
end if;
if (p_org is not null)::int+(p_household is not null)::int<>1 then raise exception 'Select one connection scope';
end if;
insert into public.partner_connections(partner_id,organization_id,location_id,household_id,connection_type,status,environment) values(p_partner,p_org,p_location,p_household,'foundation','pending',p_environment) returning partner_connections.id into v_id;
perform public.pa_activation(v_id,'connection_created');
perform public.pa_audit(p_partner,v_id,'connection_created',jsonb_build_object('environment',p_environment));
return v_id;
end $$;

create function public.register_partner_credential(p_connection uuid,p_reference text) returns void language plpgsql security definer set search_path='' as $$declare c public.partner_connections;
begin perform public.pa_operator(true);
select * into c from public.partner_connections where id=p_connection for update;
if c.id is null then raise exception 'Connection unavailable';
end if;
update public.partner_connections set credential_ref=p_reference,runtime_enabled=false,credential_configured_at=null,last_validated_at=null,last_validation_status=null,production_approved_at=null,updated_at=now() where id=c.id;
perform public.pa_activation(c.id,'credentials_registered');
perform public.pa_audit(c.partner_id,c.id,'credentials_registered');
end $$;
-- Trusted validation runtime derives credentials-present; browser cannot assert success.

create function public.prepare_partner_validation(p_actor uuid,p_connection uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare c public.partner_connections;
p public.partner_organizations;
begin if not exists(select 1 from public.partner_operator_memberships where user_id=p_actor and active) then raise exception 'Operator required';
end if;
select * into c from public.partner_connections where id=p_connection;
select * into p from public.partner_organizations where id=c.partner_id;
if c.id is null or c.status='revoked' then raise exception 'Unavailable';
end if;
return jsonb_build_object('connectionId',c.id,'partnerKey',p.partner_key,'environment',c.environment,'credentialRef',c.credential_ref,'contractValid',c.environment='sandbox' or p.contract_status='executed','capabilities',(select coalesce(jsonb_agg(capability_key),'[]') from public.partner_capabilities where partner_id=p.id and environment=c.environment and status='approved' and (expires_at is null or expires_at>now())));
end $$;

create function public.record_partner_validation(p_actor uuid,p_connection uuid,p_reference text,p_configured boolean,p_success boolean,p_error text default null) returns void language plpgsql security definer set search_path='' as $$declare c public.partner_connections;
begin if not exists(select 1 from public.partner_operator_memberships where user_id=p_actor and active) then raise exception 'Operator required';
end if;
select * into c from public.partner_connections where id=p_connection for update;
if c.id is null or c.credential_ref is distinct from p_reference then raise exception 'Validation context changed';
end if;
if p_success and not p_configured then raise exception 'Credentials required';
end if;
update public.partner_connections set credential_configured_at=case when p_configured then coalesce(credential_configured_at,now()) end,last_validated_at=now(),last_validation_status=case when p_success then 'success' else 'failed' end,last_validation_error=case when p_success then null else p_error end,runtime_enabled=false,production_approved_at=null,updated_at=now() where id=c.id;
perform public.pa_activation(c.id,case when p_success then 'validation_succeeded' else 'validation_failed' end);
insert into public.partner_operator_audit_events(actor_user_id,partner_id,connection_id,event_type) values(p_actor,c.partner_id,c.id,'validation_recorded');
end $$;

create function public.partner_activation_action(p_connection uuid,p_action text,p_reason text default null) returns void language plpgsql security definer set search_path='' as $$declare c public.partner_connections;
ev text;
begin perform public.pa_operator(p_action in ('approve_production','enable'));
select * into c from public.partner_connections where id=p_connection for update;
if c.id is null or c.status='revoked' then raise exception 'Connection unavailable';
end if;
 if p_action='request_production' then if c.environment<>'production' then raise exception 'Production connection required';
end if;
update public.partner_connections set production_requested_at=now() where id=c.id;
ev:='production_requested';
 elsif p_action='approve_production' then if c.environment<>'production' or c.production_requested_at is null or not public.pa_ready(c.id,c.partner_id,c.environment,c.credential_ref,c.credential_configured_at,c.last_validated_at,c.last_validation_status,now()) then raise exception 'Production prerequisites missing';
end if;
update public.partner_connections set production_approved_at=now() where id=c.id;
ev:='production_approved';
 elsif p_action='enable' then update public.partner_connections set status='active',runtime_enabled=true,activated_at=now(),paused_at=null,pause_reason=null where id=c.id;
ev:=c.environment||'_enabled';
 elsif p_action in ('pause','disable','revoke') then update public.partner_connections set runtime_enabled=false,status=case when p_action='revoke' then 'revoked' when p_action='pause' then 'paused' else 'pending' end,paused_at=now(),pause_reason=p_reason where id=c.id;
ev:=case when p_action='revoke' then 'connection_revoked' when c.environment='production' and p_action='pause' then 'production_paused' else c.environment||'_disabled' end;
 else raise exception 'Invalid activation action';
end if;
perform public.pa_activation(c.id,ev,p_reason);
perform public.pa_audit(c.partner_id,c.id,'runtime_changed',jsonb_build_object('environment',c.environment,'reason',p_reason,'to_status',p_action));
end $$;

create function public.set_partner_operational_status(p_partner uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$begin perform public.pa_operator(p_status in ('active','sandbox'));
if p_status not in ('candidate','sandbox','active','paused','terminated') then raise exception 'Invalid status';
end if;
update public.partner_organizations set status=p_status,updated_at=now() where id=p_partner;
if not found then raise exception 'Partner unavailable';
end if;
perform public.pa_audit(p_partner,null,'partner_paused',jsonb_build_object('to_status',p_status));
end $$;

create function public.set_partner_data_grant(p_connection uuid,p_category text,p_purpose text,p_direction text,p_enabled boolean,p_expires timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$declare c public.partner_connections;
g uuid;
begin select * into c from public.partner_connections where id=p_connection for update;
if c.id is null or c.status='revoked' then raise exception 'Connection unavailable';
end if;
 if c.household_id is not null then if not exists(select 1 from public.households where id=c.household_id and owner_id=auth.uid()) then raise exception 'Owner authorization required';
end if;
else perform public.pa_operator(true);
end if;
 if p_category is null or p_category not in ('pet_identity','owner_contact','appointment_data') or p_purpose is null or p_purpose not in ('scheduling','integration_setup') or p_direction is null or p_direction not in ('pawport_to_partner','partner_to_pawport','bidirectional') then raise exception 'Invalid grant category';
end if;
 if p_enabled is null or (p_expires is not null and (not isfinite(p_expires) or p_expires<=now() or p_expires>now()+interval '1 year')) then raise exception 'Invalid grant expiration';
end if;
 update public.partner_data_grants set status='revoked',revoked_at=now() where connection_id=c.id and data_category=p_category and purpose=p_purpose and direction=p_direction and status='active';
 if p_enabled then insert into public.partner_data_grants(connection_id,household_id,organization_id,location_id,grantor_user_id,data_category,purpose,direction,expires_at) values(c.id,c.household_id,c.organization_id,c.location_id,auth.uid(),p_category,p_purpose,p_direction,p_expires) returning id into g;
end if;
perform public.pa_audit(c.partner_id,c.id,'grant_changed');
return g;
end $$;

create function public.partner_connection_authorized(p_connection uuid,p_capability text,p_household uuid,p_org uuid,p_location uuid,p_categories text[],p_purpose text,p_direction text) returns boolean language plpgsql stable security definer set search_path='' as $$declare c public.partner_connections;
cat text;
begin
 select * into c from public.partner_connections where id=p_connection;
 if c.id is null or c.status<>'active' or not c.runtime_enabled or not public.pa_ready(c.id,c.partner_id,c.environment,c.credential_ref,c.credential_configured_at,c.last_validated_at,c.last_validation_status,c.production_approved_at) then return false;
end if;
 if (c.household_id,c.organization_id,c.location_id) is distinct from (p_household,p_org,p_location) then return false;
end if;
 if c.organization_id is not null and not exists(select 1 from public.service_provider_organizations where id=c.organization_id and status='active') then return false;
end if;
 if c.location_id is not null and not exists(select 1 from public.service_provider_locations where id=c.location_id and status='active') then return false;
end if;
 if not exists(select 1 from public.partner_capabilities where partner_id=c.partner_id and capability_key=p_capability and environment=c.environment and status='approved' and (expires_at is null or expires_at>now())) then return false;
end if;
 if p_categories is null or cardinality(p_categories)>3 or p_purpose not in ('scheduling','integration_setup') or p_direction not in ('pawport_to_partner','partner_to_pawport') or p_purpose is null or p_direction is null then return false;
end if;
 -- Owner-data scheduling operations cannot omit their data categories.
 if p_capability in ('scheduling.appointment.read','scheduling.appointment.book','scheduling.appointment.cancel') and not ('appointment_data'=any(p_categories)) then return false;
end if;
 if p_capability='scheduling.appointment.book' and not (array['pet_identity','owner_contact']::text[]<@p_categories) then return false;
end if;
 foreach cat in array p_categories loop
 if cat is null or cat not in ('pet_identity','owner_contact','appointment_data') or not exists(select 1 from public.partner_data_grants g where g.connection_id=c.id and (g.household_id,g.organization_id,g.location_id) is not distinct from (p_household,p_org,p_location) and g.data_category=cat and g.purpose=p_purpose and g.direction in (p_direction,'bidirectional') and g.status='active' and (g.expires_at is null or g.expires_at>now()) and (g.household_id is null or exists(select 1 from public.households where id=g.household_id and owner_id=g.grantor_user_id))) then return false;
end if;
 end loop;
return true;
end $$;

create function public.enqueue_partner_event(p_connection uuid,p_direction text,p_type text,p_external text,p_idempotency text) returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid;
e public.partner_integration_events;
begin perform 1 from public.partner_connections where partner_connections.id=p_connection for update;
if not found then raise exception 'Connection unavailable';
end if;
 select * into e from public.partner_integration_events where connection_id=p_connection and ((p_external is not null and direction=p_direction and external_event_id=p_external) or (p_idempotency is not null and idempotency_key=p_idempotency)) limit 1;
 if e.id is not null then if e.direction<>p_direction or e.event_type<>p_type or (p_external is not null and e.external_event_id is distinct from p_external) or (p_idempotency is not null and e.idempotency_key is distinct from p_idempotency) then raise exception 'Idempotency conflict';
end if;
return e.id;
end if;
 if (select count(*) from public.partner_integration_events where connection_id=p_connection and created_at>now()-interval '1 minute')>=100 then raise exception 'Event rate limit';
end if;
 insert into public.partner_integration_events(connection_id,direction,event_type,external_event_id,idempotency_key) values(p_connection,p_direction,p_type,p_external,p_idempotency) returning partner_integration_events.id into v_id;
return v_id;
end $$;

create function public.claim_partner_events(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;
begin if p_limit not between 1 and 100 or p_limit is null then raise exception 'Invalid batch';
end if;
 -- A lost mutation lease may have reached the vendor; never retry it automatically.
 update public.partner_integration_events set status=case when event_type in ('appointment_book','appointment_cancel') then 'unknown' when attempt_count>=10 then 'dead_letter' else 'pending' end,lease_token=null,lease_until=null,error_code='unknown',updated_at=now() where status='processing' and lease_until<now();
 with candidates as(select e.id from public.partner_integration_events e join public.partner_connections c on c.id=e.connection_id where e.status in ('received','pending','failed') and e.attempt_count<10 and e.available_after<=now() and c.runtime_enabled and c.status='active' and public.pa_ready(c.id,c.partner_id,c.environment,c.credential_ref,c.credential_configured_at,c.last_validated_at,c.last_validation_status,c.production_approved_at) order by e.created_at,e.id for update of e skip locked limit p_limit), claimed as(update public.partner_integration_events e set status='processing',attempt_count=attempt_count+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',updated_at=now() from candidates x where e.id=x.id returning e.id,e.connection_id,e.event_type,e.direction,e.correlation_id,e.lease_token,e.lease_until,e.attempt_count) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
return result;
end $$;

create function public.complete_partner_event(p_event uuid,p_lease uuid,p_http integer default null) returns void language plpgsql security definer set search_path='' as $$begin update public.partner_integration_events set status='completed',completed_at=now(),updated_at=now(),http_status=p_http,error_code=null,lease_token=null,lease_until=null where id=p_event and status='processing' and lease_token=p_lease and lease_until>now();
if not found then raise exception 'Lease unavailable';
end if;
end $$;

create function public.fail_partner_event(p_event uuid,p_lease uuid,p_error text,p_ambiguous boolean default false,p_http integer default null) returns void language plpgsql security definer set search_path='' as $$begin if p_ambiguous is null then raise exception 'Outcome required';
end if;
update public.partner_integration_events set status=case when p_ambiguous then 'unknown' when attempt_count>=10 then 'dead_letter' else 'failed' end,error_code=case when p_ambiguous then 'unknown' else p_error end,http_status=p_http,available_after=now()+make_interval(secs=>least(3600,30*power(2,attempt_count)::int)),lease_token=null,lease_until=null,updated_at=now() where id=p_event and status='processing' and lease_token=p_lease and lease_until>now();
if not found then raise exception 'Lease unavailable';
end if;
end $$;
-- No retry operation accepts unknown. Feature-specific conclusive reconciliation is future work.

create function public.save_partner_pilot(p_partner uuid,p_pilot uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid;
co uuid;
org uuid;
loc uuid;
begin perform public.pa_operator();
perform public.ins_object(p_data,array['connection_id','organization_id','location_id','external_site_reference','status','consent_received_at','pilot_started_at','pilot_ends_at','completed_at','notes']);
co:=nullif(p_data->>'connection_id','')::uuid;
org:=nullif(p_data->>'organization_id','')::uuid;
loc:=nullif(p_data->>'location_id','')::uuid;
 if co is not null and not exists(select 1 from public.partner_connections where partner_connections.id=co and partner_id=p_partner and household_id is null and organization_id is not distinct from org and location_id is not distinct from loc) then raise exception 'Pilot connection mismatch';
end if;
 if loc is not null and not exists(select 1 from public.service_provider_locations where service_provider_locations.id=loc and organization_id=org) then raise exception 'Pilot location mismatch';
end if;
 if p_pilot is null then insert into public.partner_pilot_sites(partner_id,connection_id,organization_id,location_id) values(p_partner,co,org,loc) returning partner_pilot_sites.id into v_id;
else select p.id into v_id from public.partner_pilot_sites p where p.id=p_pilot and partner_id=p_partner and connection_id is not distinct from co and organization_id is not distinct from org and location_id is not distinct from loc for update;
if v_id is null then raise exception 'Pilot identity mismatch';
end if;
end if;
 update public.partner_pilot_sites set external_site_reference=p_data->>'external_site_reference',status=coalesce(p_data->>'status','candidate'),consent_received_at=nullif(p_data->>'consent_received_at','')::timestamptz,pilot_started_at=nullif(p_data->>'pilot_started_at','')::timestamptz,pilot_ends_at=nullif(p_data->>'pilot_ends_at','')::timestamptz,completed_at=nullif(p_data->>'completed_at','')::timestamptz,notes=p_data->>'notes',updated_at=now() where partner_pilot_sites.id=v_id;
perform public.pa_audit(p_partner,co,'pilot_updated');
return v_id;
end $$;

create function public.link_partner_provider_connection(p_connection uuid,p_provider uuid) returns void language plpgsql security definer set search_path='' as $$begin perform public.pa_operator(true);
if not exists(select 1 from public.partner_connections c join public.partner_organizations p on p.id=c.partner_id join public.service_provider_locations l on l.id=c.location_id and l.organization_id=c.organization_id join public.provider_connections v on v.google_place_id=l.google_place_id where c.id=p_connection and v.id=p_provider and p.partner_key='ezyvet' and v.external_system='ezyvet') then raise exception 'Scheduling bridge mismatch';
end if;
insert into public.partner_provider_connection_links values(p_connection,p_provider,now()) on conflict do nothing;
perform public.pa_audit((select partner_id from public.partner_connections where id=p_connection),p_connection,'bridge_created');
end $$;

create function public.pa_connection_dto(c public.partner_connections) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('id',c.id,'partnerId',c.partner_id,'organizationId',c.organization_id,'locationId',c.location_id,'scope',case when c.household_id is not null then 'household' else 'business' end,'environment',c.environment,'status',c.status,'runtimeEnabled',c.runtime_enabled and c.status='active' and public.pa_ready(c.id,c.partner_id,c.environment,c.credential_ref,c.credential_configured_at,c.last_validated_at,c.last_validation_status,c.production_approved_at),'credentialReferencePresent',c.credential_ref is not null,'credentialConfigured',c.credential_configured_at is not null,'lastValidatedAt',c.last_validated_at,'validationStatus',c.last_validation_status,'validationError',c.last_validation_error,'productionApprovedAt',c.production_approved_at,'health',case when c.status in ('paused','revoked') or not c.runtime_enabled or exists(select 1 from public.partner_organizations where id=c.partner_id and status in ('paused','terminated')) then 'paused' when c.last_validated_at is null or c.last_validated_at<now()-interval '24 hours' then 'unvalidated' when c.last_validation_status='success' then 'healthy' else 'degraded' end,'lastSuccessfulEvent',(select max(completed_at) from public.partner_integration_events where connection_id=c.id and status='completed'),'deadLetters',(select count(*) from public.partner_integration_events where connection_id=c.id and status='dead_letter'),'unknownEvents',(select count(*) from public.partner_integration_events where connection_id=c.id and status='unknown'),'bridgePresent',exists(select 1 from public.partner_provider_connection_links where partner_connection_id=c.id))$$;

create function public.my_partner_operations(p_partner uuid default null,p_connection uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$declare r text;
begin r:=public.pa_operator();
if p_connection is not null and not exists(select 1 from public.partner_connections where id=p_connection and partner_id=p_partner) then raise exception 'Connection unavailable';
end if;
return jsonb_build_object('role',r,'runtime', (select jsonb_build_object('sandboxEnabled',sandbox_enabled,'productionEnabled',production_enabled) from public.partner_runtime_settings),'partners',coalesce((select jsonb_agg(to_jsonb(p)) from(select * from public.partner_organizations where p_partner is null or id=p_partner order by display_name,id limit 100)p),'[]'),'connections',coalesce((select jsonb_agg(public.pa_connection_dto(c)) from(select * from public.partner_connections where (p_partner is null or partner_id=p_partner) and (p_connection is null or id=p_connection) order by created_at desc,id limit 100)c),'[]'),'capabilities',coalesce((select jsonb_agg(to_jsonb(c)-array['approved_by']) from(select * from public.partner_capabilities where p_partner is not null and partner_id=p_partner order by capability_key,environment limit 100)c),'[]'),'grants',coalesce((select jsonb_agg(jsonb_build_object('id',id,'dataCategory',data_category,'purpose',purpose,'direction',direction,'status',case when expires_at<now() and status='active' then 'expired' else status end,'expiresAt',expires_at)) from public.partner_data_grants where p_connection is not null and connection_id=p_connection and status='active'),'[]'),'events',coalesce((select jsonb_agg(to_jsonb(e)-array['external_event_id','idempotency_key','lease_token']) from(select * from public.partner_integration_events where p_connection is not null and connection_id=p_connection order by created_at desc limit 100)e),'[]'),'activation',coalesce((select jsonb_agg(to_jsonb(a)-'actor') from(select * from public.partner_connection_activation_events where p_connection is not null and connection_id=p_connection order by created_at desc limit 100)a),'[]'),'audit',coalesce((select jsonb_agg(to_jsonb(a)-'actor_user_id') from(select * from public.partner_operator_audit_events where p_partner is not null and partner_id=p_partner order by created_at desc limit 100)a),'[]'),'pilots',coalesce((select jsonb_agg(to_jsonb(s)) from(select * from public.partner_pilot_sites where p_partner is not null and partner_id=p_partner order by created_at desc limit 100)s),'[]'),'pilotTarget',5,'pilotCounts',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from public.partner_pilot_sites where partner_id=p_partner group by status)x),'{}'));
end $$;

create function public.my_partner_connection_consent(p_connection uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare c public.partner_connections;
begin select c1.* into c from public.partner_connections c1 join public.households h on h.id=c1.household_id where c1.id=p_connection and h.owner_id=auth.uid();
if c.id is null then raise exception 'Connection unavailable';
end if;
return jsonb_build_object('id',c.id,'partnerName',(select display_name from public.partner_organizations where id=c.partner_id),'status',c.status,'environment',c.environment,'grants',coalesce((select jsonb_agg(jsonb_build_object('category',data_category,'purpose',purpose,'direction',direction,'expiresAt',expires_at)) from public.partner_data_grants where connection_id=c.id and status='active' and (expires_at is null or expires_at>now())),'[]'));
end $$;
-- Nothing grants the application an operator membership, a runtime flag, or an active partner.
do $$declare t text;
f record;
begin
 foreach t in array array['partner_operator_memberships','partner_runtime_settings','partner_capabilities','partner_connection_activation_events','partner_data_grants','partner_integration_events','partner_operator_audit_events','partner_pilot_sites','partner_provider_connection_links'] loop execute format('alter table public.%I enable row level security',t);
execute format('revoke all on public.%I from public,anon,authenticated',t);
end loop;
 for f in select p.oid::regprocedure sig,p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (left(p.proname,3)='pa_' or p.proname in ('bootstrap_partner_operator','save_partner_registry','set_partner_capability','create_partner_operational_connection','register_partner_credential','prepare_partner_validation','record_partner_validation','partner_activation_action','set_partner_operational_status','set_partner_data_grant','partner_connection_authorized','enqueue_partner_event','claim_partner_events','complete_partner_event','fail_partner_event','save_partner_pilot','link_partner_provider_connection','my_partner_operations','my_partner_connection_consent')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 if f.name in ('save_partner_registry','set_partner_capability','create_partner_operational_connection','register_partner_credential','partner_activation_action','set_partner_operational_status','set_partner_data_grant','save_partner_pilot','link_partner_provider_connection','my_partner_operations','my_partner_connection_consent') then execute format('grant execute on function %s to authenticated',f.sig);
end if;
 if f.name in ('partner_connection_authorized','enqueue_partner_event','claim_partner_events','complete_partner_event','fail_partner_event','prepare_partner_validation','record_partner_validation') then execute format('grant execute on function %s to pawport_partner_worker',f.sig);
 if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant execute on function %s to service_role',f.sig);end if;
end if;
 end loop;
end $$;
grant execute on function public.bootstrap_partner_operator(uuid,text,boolean) to pawport_partner_operator;
commit;
