begin;
alter table public.service_provider_services add column accepts_quote_requests boolean not null default false;

create table public.service_quote_requests(id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id),pet_id uuid not null references public.pets(id),owner_id uuid not null references auth.users(id),organization_id uuid not null references public.service_provider_organizations(id),location_id uuid not null references public.service_provider_locations(id),service_id uuid not null references public.service_provider_services(id),title text not null check(length(btrim(title)) between 1 and 160),owner_note text check(length(owner_note)<=1000),status text not null default 'requested' check(status in ('requested','quoted','declined','withdrawn','expired')),expires_at timestamptz not null default now()+interval '7 days',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index quote_owner_page on public.service_quote_requests(owner_id,created_at desc,id);
create index quote_location_page on public.service_quote_requests(location_id,created_at desc,id);
create unique index quote_open_request on public.service_quote_requests(owner_id,pet_id,location_id,service_id) where status in ('requested','quoted');

create table public.service_quotes(id uuid primary key default gen_random_uuid(),request_id uuid unique not null references public.service_quote_requests(id),organization_id uuid not null references public.service_provider_organizations(id),location_id uuid not null references public.service_provider_locations(id),service_id uuid not null references public.service_provider_services(id),created_by uuid not null references auth.users(id),currency text not null default 'USD' check(currency='USD'),status text not null default 'draft' check(status in ('draft','sent','withdrawn','expired')),current_revision integer not null default 0 check(current_revision between 0 and 25),created_at timestamptz not null default now(),updated_at timestamptz not null default now());

create table public.service_quote_versions(id uuid primary key default gen_random_uuid(),quote_id uuid not null references public.service_quotes(id),revision integer not null check(revision between 1 and 25),created_by uuid not null references auth.users(id),amount_type text not null check(amount_type in ('exact','range','contact_for_price')),amount_cents bigint check(amount_cents between 0 and 9000000000000),minimum_amount_cents bigint check(minimum_amount_cents between 0 and 9000000000000),maximum_amount_cents bigint check(maximum_amount_cents between 0 and 9000000000000),valid_until date check(valid_until between date '2000-01-01' and date '2200-12-31'),provider_note text check(length(provider_note)<=1000),created_at timestamptz not null default now(),unique(quote_id,revision),check((amount_type='exact' and amount_cents is not null and minimum_amount_cents is null and maximum_amount_cents is null) or (amount_type='range' and amount_cents is null and minimum_amount_cents is not null and maximum_amount_cents is not null and minimum_amount_cents<=maximum_amount_cents) or (amount_type='contact_for_price' and amount_cents is null and minimum_amount_cents is null and maximum_amount_cents is null)));

create table public.service_provider_offers(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.service_provider_organizations(id),location_id uuid references public.service_provider_locations(id),created_by uuid not null references auth.users(id),title text not null check(length(btrim(title)) between 1 and 120),description text not null check(length(btrim(description)) between 1 and 1000),offer_type text not null check(offer_type in ('promotion','new_client','service_package','informational')),value_text text check(length(value_text)<=100),terms text check(length(terms)<=1500),starts_on date check(starts_on between date '2000-01-01' and date '2200-12-31'),ends_on date check(ends_on between date '2000-01-01' and date '2200-12-31'),status text not null default 'draft' check(status in ('draft','published','paused','expired','archived')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(ends_on>=starts_on));
create index business_offer_locations on public.service_provider_offers(organization_id,location_id,status);

create table public.service_review_responses(id uuid primary key default gen_random_uuid(),review_id uuid unique not null references public.service_reviews(id),organization_id uuid not null references public.service_provider_organizations(id),location_id uuid not null references public.service_provider_locations(id),created_by uuid not null references auth.users(id),body text not null check(length(btrim(body)) between 1 and 1500),status text not null default 'published' check(status in ('published','withdrawn','moderated')),created_at timestamptz not null default now(),updated_at timestamptz not null default now());

create table public.service_review_response_reports(id uuid primary key default gen_random_uuid(),reporter_id uuid not null references auth.users(id),response_id uuid not null references public.service_review_responses(id),reason text not null check(reason in ('harassment','privacy','spam','misleading','other')),details text check(length(details)<=500),created_at timestamptz not null default now(),unique(reporter_id,response_id));

create table public.partner_organizations(id uuid primary key default gen_random_uuid(),partner_key text unique not null check(partner_key ~ '^[a-z0-9_]{1,80}$'),display_name text not null check(length(btrim(display_name)) between 1 and 160),partner_type text not null check(partner_type in ('pharmacy','laboratory','insurance_carrier','practice_management','grooming','boarding','training','pet_retail','other')),status text not null default 'candidate' check(status in ('candidate','sandbox','active','paused','terminated')),website_url text check(length(website_url)<=2048 and website_url ~ '^https://[^[:space:]]+$'),created_at timestamptz not null default now(),updated_at timestamptz not null default now());

create table public.partner_connections(id uuid primary key default gen_random_uuid(),partner_id uuid not null references public.partner_organizations(id),organization_id uuid references public.service_provider_organizations(id),location_id uuid references public.service_provider_locations(id),household_id uuid references public.households(id),connection_type text not null check(length(btrim(connection_type)) between 1 and 80),credential_ref text check(credential_ref ~ '^PARTNER_[A-Z0-9_]{1,100}$'),status text not null default 'pending' check(status in ('pending','sandbox','active','paused','error','revoked')),capabilities jsonb not null default '{}' check(capabilities='{}'::jsonb),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(not(organization_id is not null and household_id is not null)),check(location_id is null or organization_id is not null));
-- No seeded relationships, credentials, public partner badge or runtime adapters.
do $$begin if not exists(select 1 from pg_roles where rolname='pawport_partner_operator') then create role pawport_partner_operator nologin noinherit;
end if;
end $$;
grant usage on schema public to pawport_partner_operator;

create function public.ec_authorize(p_org uuid,p_location uuid default null,p_write boolean default false) returns text language plpgsql stable security definer set search_path='' as $$declare r text;
begin select m.role into r from public.service_provider_memberships m join public.service_provider_organizations o on o.id=m.organization_id where m.organization_id=p_org and m.user_id=auth.uid() and m.active and o.status='active';
if r is null or (p_write and r not in ('owner','admin')) or (p_location is not null and not public.service_provider_can_access_location(p_org,p_location)) then raise exception 'Business information unavailable';
end if;
return r;
end $$;

create function public.ec_published(p_location uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id join public.service_provider_location_profiles p on p.location_id=l.id where l.id=p_location and l.status='active' and o.status='active' and p.profile_status='published')$$;

create function public.ec_history_guard() returns trigger language plpgsql set search_path='' as $$begin raise exception 'History is immutable';
end $$;
create trigger quote_version_immutable before update or delete on public.service_quote_versions for each row execute function public.ec_history_guard();

create function public.ec_identity() returns trigger language plpgsql set search_path='' as $$begin if tg_op='DELETE' then raise exception 'History cannot be deleted';
end if;
 if tg_table_name='service_quote_requests' then if (new.id,new.household_id,new.pet_id,new.owner_id,new.organization_id,new.location_id,new.service_id,new.title,new.owner_note,new.created_at) is distinct from (old.id,old.household_id,old.pet_id,old.owner_id,old.organization_id,old.location_id,old.service_id,old.title,old.owner_note,old.created_at) then raise exception 'Request identity immutable';
end if;
 elsif tg_table_name='service_quotes' then if (new.id,new.request_id,new.organization_id,new.location_id,new.service_id,new.created_by,new.currency,new.created_at) is distinct from (old.id,old.request_id,old.organization_id,old.location_id,old.service_id,old.created_by,old.currency,old.created_at) then raise exception 'Quote identity immutable';
end if;
 else if (new.id,new.organization_id,new.location_id,new.created_by,new.created_at) is distinct from (old.id,old.organization_id,old.location_id,old.created_by,old.created_at) then raise exception 'Business record identity immutable';
end if;
 if tg_table_name='service_review_responses' then if new.review_id<>old.review_id then raise exception 'Review identity immutable';
end if;
end if;
end if;
return new;
end $$;
do $$declare t text;
begin foreach t in array array['service_quote_requests','service_quotes','service_provider_offers','service_review_responses'] loop execute format('create trigger ecosystem_identity before update or delete on public.%I for each row execute function public.ec_identity()',t);
end loop;
end $$;
alter table public.service_provider_audit_events drop constraint service_provider_audit_events_event_type_check;
alter table public.service_provider_audit_events add constraint service_provider_audit_events_event_type_check check(event_type in ('invitation_created','invitation_revoked','invitation_accepted','member_role_changed','member_location_access_changed','member_deactivated','quote_sent','quote_revised','quote_declined','quote_withdrawn','offer_published','offer_paused','offer_archived','review_response_published','review_response_withdrawn'));

create function public.set_service_quote_requests(p_org uuid,p_location uuid,p_service uuid,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$begin perform public.ec_authorize(p_org,p_location,true);
if p_enabled is null then raise exception 'Invalid setting';
end if;
update public.service_provider_services set accepts_quote_requests=p_enabled where id=p_service and location_id=p_location and active;
if not found then raise exception 'Service unavailable';
end if;
end $$;

create function public.submit_service_quote_request(p_pet uuid,p_location uuid,p_service uuid,p_note text default null) returns uuid language plpgsql security definer set search_path='' as $$declare h uuid;
l public.service_provider_locations;
s public.service_provider_services;
v_id uuid;
begin
 h:=public.cost_owner(p_pet);
perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('quote-owner:'||auth.uid(),0));
 update public.service_quote_requests set status='expired',updated_at=now() where owner_id=auth.uid() and status in ('requested','quoted') and expires_at<now();
 if (select count(*) from public.service_quote_requests where owner_id=auth.uid() and created_at>now()-interval '1 day')>=20 or (select count(*) from public.service_quote_requests where owner_id=auth.uid() and status in ('requested','quoted'))>=10 then raise exception 'Quote request limit reached';
end if;
 select * into l from public.service_provider_locations where id=p_location;
select * into s from public.service_provider_services where id=p_service and location_id=p_location and active and accepts_quote_requests;
 if s.id is null or not public.ec_published(p_location) then raise exception 'Quote requests unavailable';
end if;
 insert into public.service_quote_requests(household_id,pet_id,owner_id,organization_id,location_id,service_id,title,owner_note) values(h,p_pet,auth.uid(),l.organization_id,l.id,s.id,s.name,p_note) returning id into v_id;
return v_id;
end $$;

create function public.withdraw_service_quote_request(p_pet uuid,p_request uuid) returns void language plpgsql security definer set search_path='' as $$begin perform public.cost_owner(p_pet);
update public.service_quote_requests set status='withdrawn',updated_at=now() where id=p_request and pet_id=p_pet and owner_id=auth.uid() and status in ('requested','quoted') returning id into p_request;
if not found then raise exception 'Request unavailable';
end if;
update public.service_quotes set status='withdrawn',updated_at=now() where request_id=p_request;
end $$;

create function public.ec_quote_json(p_quote uuid,p_revision integer default null) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('quoteId',q.id,'revision',v.revision,'amountType',v.amount_type,'amountCents',v.amount_cents::text,'minimumAmountCents',v.minimum_amount_cents::text,'maximumAmountCents',v.maximum_amount_cents::text,'validUntil',v.valid_until,'note',v.provider_note,'status',case when v.valid_until<current_date then 'expired' else q.status end,'sourceLabel','Provider quote') from public.service_quotes q join public.service_quote_versions v on v.quote_id=q.id and v.revision=coalesce(p_revision,q.current_revision) where q.id=p_quote$$;

create function public.ec_request_json(r public.service_quote_requests,p_provider boolean) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('requestId',r.id,'businessName',o.name,'locationId',l.id,'locationName',coalesce(lp.display_name,o.name),'serviceName',r.title,'serviceId',r.service_id,'status',case when r.status in ('requested','quoted') and r.expires_at<now() then 'expired' else r.status end,'requestedAt',r.created_at,'ownerNote',r.owner_note,'currentQuote',(select public.ec_quote_json(id) from public.service_quotes where request_id=r.id and status<>'draft'),'history',coalesce((select jsonb_agg(public.ec_quote_json(q.id,v.revision) order by v.revision desc) from public.service_quotes q join public.service_quote_versions v on v.quote_id=q.id where q.request_id=r.id),'[]'))||case when p_provider then jsonb_build_object('pet',jsonb_build_object('name',p.name,'species',p.species)) else jsonb_build_object('petId',p.id,'petName',p.name) end from public.service_provider_organizations o join public.service_provider_locations l on l.organization_id=o.id left join public.service_provider_location_profiles lp on lp.location_id=l.id join public.pets p on p.id=r.pet_id where o.id=r.organization_id and l.id=r.location_id$$;

create function public.my_service_quote_requests(p_pet uuid default null,p_request uuid default null,p_before timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$begin if auth.uid() is null then raise exception 'Quotes unavailable';
end if;
if p_pet is not null then perform public.cost_owner(p_pet);
end if;
if p_request is not null and not exists(select 1 from public.service_quote_requests where id=p_request and owner_id=auth.uid() and (p_pet is null or pet_id=p_pet)) then raise exception 'Quote unavailable';
end if;
return(select coalesce(jsonb_agg(public.ec_request_json(r,false) order by r.created_at desc,r.id desc),'[]') from(select * from public.service_quote_requests where owner_id=auth.uid() and (p_pet is null or pet_id=p_pet) and (p_request is null or id=p_request) and (p_before_id is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 50)r);
end $$;

create function public.service_provider_quote_requests(p_org uuid,p_request uuid default null,p_before timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform public.ec_authorize(p_org);
if p_request is not null and not exists(select 1 from public.service_quote_requests where id=p_request and organization_id=p_org and public.service_provider_can_access_location(p_org,location_id)) then raise exception 'Quote unavailable';
end if;
return(select coalesce(jsonb_agg(public.ec_request_json(r,true) order by r.created_at desc,r.id desc),'[]') from(select * from public.service_quote_requests where organization_id=p_org and public.service_provider_can_access_location(p_org,location_id) and (p_request is null or id=p_request) and (p_before_id is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 50)r);
end $$;
-- Extend notification identity without loosening any existing type's constraints.
alter table public.notifications add column quote_request_id uuid references public.service_quote_requests(id);
do $$declare n text;
old_check text;
new_check text;
begin
 new_check:='type=''provider_quote_update'' and channel=''in_app'' and quote_request_id is not null and subject_pet_id is not null and appointment_request_id is null and appointment_reminder_id is null and verification_request_id is null and live_mutation_id is null and action_url ~ ''^/pets/[a-f0-9-]{36}/quotes/[a-f0-9-]{36}$''';
 foreach n in array array['notifications_type_check','notifications_action_url_check','owner_notification_references'] loop select pg_get_expr(conbin,conrelid) into old_check from pg_constraint where conrelid='public.notifications'::regclass and conname=n;
execute format('alter table public.notifications drop constraint %I',n);
execute format('alter table public.notifications add constraint %I check (((%s) and quote_request_id is null) or (%s))',n,old_check,new_check);
end loop;
end $$;

create function public.ec_notification_guard() returns trigger language plpgsql security definer set search_path='' as $$begin if tg_op='UPDATE' and new.quote_request_id is distinct from old.quote_request_id then raise exception 'Quote notification identity immutable';
end if;
if new.type='provider_quote_update' and not exists(select 1 from public.service_quote_requests r where r.id=new.quote_request_id and r.owner_id=new.user_id and r.pet_id=new.subject_pet_id and new.action_url='/pets/'||r.pet_id||'/quotes/'||r.id and new.dedupe_key like 'provider-quote:'||r.id||':%') then raise exception 'Invalid quote notification';
end if;
return new;
end $$;
create trigger quote_notification_integrity before insert or update on public.notifications for each row execute function public.ec_notification_guard();

create function public.ec_notify(p_request uuid,p_key text,p_title text) returns void language sql security definer set search_path='' as $$insert into public.notifications(user_id,type,title,body,action_url,dedupe_key,subject_pet_id,quote_request_id) select owner_id,'provider_quote_update',p_title,'View the business response to your quote request.','/pets/'||pet_id||'/quotes/'||id,'provider-quote:'||id||':'||p_key,pet_id,id from public.service_quote_requests where id=p_request on conflict do nothing$$;

create function public.send_service_quote(p_org uuid,p_request uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare r public.service_quote_requests;
q public.service_quotes;
v integer;
until_date date;
begin
 select * into r from public.service_quote_requests where id=p_request and organization_id=p_org for update;
if r.id is null then raise exception 'Request unavailable';
end if;
perform public.ec_authorize(p_org,r.location_id,true);
 if r.status not in ('requested','quoted') or r.expires_at<now() then raise exception 'Request is closed';
end if;
 perform public.ins_object(p_data,array['amount_type','amount_cents','minimum_amount_cents','maximum_amount_cents','valid_until','provider_note']);
until_date:=public.ins_date(p_data->>'valid_until');
 select * into q from public.service_quotes where request_id=r.id for update;
if q.id is null then insert into public.service_quotes(request_id,organization_id,location_id,service_id,created_by) values(r.id,r.organization_id,r.location_id,r.service_id,auth.uid()) returning * into q;
end if;
v:=q.current_revision+1;
if v>25 then raise exception 'Quote revision limit reached';
end if;
 insert into public.service_quote_versions(quote_id,revision,created_by,amount_type,amount_cents,minimum_amount_cents,maximum_amount_cents,valid_until,provider_note) values(q.id,v,auth.uid(),p_data->>'amount_type',public.ins_cents(p_data->>'amount_cents'),public.ins_cents(p_data->>'minimum_amount_cents'),public.ins_cents(p_data->>'maximum_amount_cents'),until_date,p_data->>'provider_note');
 update public.service_quotes set status=case when until_date<current_date then 'expired' else 'sent' end,current_revision=v,updated_at=now() where id=q.id;
update public.service_quote_requests set status=case when until_date<current_date then 'expired' else 'quoted' end,expires_at=coalesce(until_date::timestamptz+interval '1 day',now()+interval '30 days'),updated_at=now() where id=r.id;
 perform public.bd_audit(p_org,case when v=1 then 'quote_sent' else 'quote_revised' end);
perform public.ec_notify(r.id,'revision:'||v,'Provider quote received');
return q.id;
end $$;

create function public.close_service_quote(p_org uuid,p_request uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$declare r public.service_quote_requests;
begin select * into r from public.service_quote_requests where id=p_request and organization_id=p_org for update;
if r.id is null then raise exception 'Request unavailable';
end if;
perform public.ec_authorize(p_org,r.location_id,true);
if r.status not in ('requested','quoted') or p_action not in ('declined','withdrawn') then raise exception 'Invalid quote action';
end if;
update public.service_quote_requests set status=p_action,updated_at=now() where id=r.id;
update public.service_quotes set status='withdrawn',updated_at=now() where request_id=r.id;
perform public.bd_audit(p_org,case when p_action='declined' then 'quote_declined' else 'quote_withdrawn' end);
if p_action='declined' then perform public.ec_notify(r.id,'declined','Quote request declined');
end if;
end $$;
-- Extend planning with a stable version reference, never a duplicated actual expense.
do $$declare c record;
begin for c in select conname from pg_constraint where conrelid='public.pet_planned_costs'::regclass and contype='c' and pg_get_constraintdef(oid) like '%source = %owner_entered%' loop execute format('alter table public.pet_planned_costs drop constraint %I',c.conname);
end loop;
end $$;
alter table public.pet_planned_costs add column quote_id uuid references public.service_quotes(id);
alter table public.pet_planned_costs add column quote_revision integer;
alter table public.pet_planned_costs add constraint planned_quote_reference foreign key(quote_id,quote_revision) references public.service_quote_versions(quote_id,revision);
alter table public.pet_planned_costs add constraint planned_quote_source check((source='owner_entered' and quote_id is null and quote_revision is null) or (source='provider_quote' and quote_id is not null and quote_revision is not null));
create unique index one_quote_plan on public.pet_planned_costs(quote_id) where quote_id is not null;

create function public.ec_planning_integrity() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='UPDATE' and (new.source,new.quote_id) is distinct from (old.source,old.quote_id) then raise exception 'Planning source immutable';
end if;
 if new.source='provider_quote' and not exists(select 1 from public.service_quotes q join public.service_quote_requests r on r.id=q.request_id join public.service_quote_versions v on v.quote_id=q.id and v.revision=new.quote_revision where q.id=new.quote_id and r.pet_id=new.pet_id and r.owner_id=new.created_by and r.household_id=new.household_id and new.planned_amount_cents is not distinct from case when v.amount_type='exact' then v.amount_cents else null end) then raise exception 'Invalid quote planning reference';
end if;
return new;
end $$;
create trigger quote_planning_integrity before insert or update on public.pet_planned_costs for each row execute function public.ec_planning_integrity();
alter function public.save_pet_planned_cost(uuid,uuid,jsonb) rename to ec_save_owner_plan;
revoke all on function public.ec_save_owner_plan(uuid,uuid,jsonb) from public,anon,authenticated;

create function public.save_pet_planned_cost(p_pet uuid,p_planned uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$begin perform public.cost_owner(p_pet,true);
if exists(select 1 from public.pet_planned_costs where id=p_planned and source='provider_quote') then raise exception 'Use explicit quote planning controls';
end if;
return public.ec_save_owner_plan(p_pet,p_planned,p_data);
end $$;

create function public.save_quote_to_planning(p_pet uuid,p_request uuid,p_year integer,p_category text,p_update boolean default false) returns uuid language plpgsql security definer set search_path='' as $$declare r public.service_quote_requests;
q public.service_quotes;
v public.service_quote_versions;
p public.pet_planned_costs;
begin
 perform public.cost_owner(p_pet,true);
perform public.cost_year(p_year);
select * into r from public.service_quote_requests where id=p_request and pet_id=p_pet and owner_id=auth.uid() for update;
if r.id is null then raise exception 'Quote unavailable';
end if;
 select * into q from public.service_quotes where request_id=r.id for update;
select * into v from public.service_quote_versions where quote_id=q.id and revision=q.current_revision;
 if r.status<>'quoted' or r.expires_at<now() or q.status<>'sent' or v.id is null or v.valid_until<current_date or not public.ec_published(r.location_id) then raise exception 'Quote is no longer available for new planning';
end if;
 select * into p from public.pet_planned_costs where quote_id=q.id for update;
if p.id is not null then if p_update then if p.status<>'planned' then raise exception 'Only open planning items may be updated';
end if;
update public.pet_planned_costs set quote_revision=v.revision,planned_amount_cents=case when v.amount_type='exact' then v.amount_cents else null end,updated_at=now() where id=p.id;
end if;
return p.id;
end if;
 if (select count(*) from public.pet_planned_costs where pet_id=p_pet and planning_year=p_year)>=200 then raise exception 'Planning limit reached';
end if;
 insert into public.pet_planned_costs(household_id,pet_id,created_by,title,category,planned_amount_cents,planning_year,source,quote_id,quote_revision) values(r.household_id,p_pet,auth.uid(),r.title,p_category,case when v.amount_type='exact' then v.amount_cents else null end,p_year,'provider_quote',q.id,v.revision) returning * into p;
return p.id;
end $$;

create function public.set_quote_planning_status(p_pet uuid,p_planned uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$begin perform public.cost_owner(p_pet,true);
if p_status not in ('planned','completed','cancelled') then raise exception 'Invalid planning status';
end if;
update public.pet_planned_costs set status=p_status,updated_at=now() where id=p_planned and pet_id=p_pet and source='provider_quote' and converted_expense_id is null;
if not found then raise exception 'Plan unavailable';
end if;
end $$;
alter function public.cost_planned_dto(public.pet_planned_costs) rename to ec_owner_planned_dto;

create function public.cost_planned_dto(p public.pet_planned_costs) returns jsonb language sql stable security definer set search_path='' as $$select public.ec_owner_planned_dto(p)||jsonb_build_object('source',p.source,'quote',case when p.quote_id is not null then public.ec_quote_json(p.quote_id,p.quote_revision) else null end,'quoteUpdated',exists(select 1 from public.service_quotes where id=p.quote_id and current_revision>p.quote_revision),'quoteRequestId',(select request_id from public.service_quotes where id=p.quote_id),'businessName',(select o.name from public.service_quotes q join public.service_provider_organizations o on o.id=q.organization_id where q.id=p.quote_id))$$;

create function public.save_service_provider_offer(p_org uuid,p_location uuid,p_offer uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid;
begin perform public.ec_authorize(p_org,p_location,true);
perform 1 from public.service_provider_organizations where id=p_org for update;
perform public.ins_object(p_data,array['title','description','offer_type','value_text','terms','starts_on','ends_on','status']);
 if p_offer is null then if (select count(*) from public.service_provider_offers where organization_id=p_org and status<>'archived')>=100 then raise exception 'Offer limit reached';
end if;
insert into public.service_provider_offers(organization_id,location_id,created_by,title,description,offer_type) values(p_org,p_location,auth.uid(),p_data->>'title',p_data->>'description',p_data->>'offer_type') returning id into v_id;
 else select id into v_id from public.service_provider_offers where id=p_offer and organization_id=p_org and location_id is not distinct from p_location for update;
if v_id is null then raise exception 'Offer unavailable';
end if;
end if;
 if coalesce(p_data->>'status','draft')<>'archived' and (select status from public.service_provider_offers where id=v_id)='archived' and (select count(*) from public.service_provider_offers where organization_id=p_org and status<>'archived')>=100 then raise exception 'Offer limit reached';
end if;
 update public.service_provider_offers set title=p_data->>'title',description=p_data->>'description',offer_type=p_data->>'offer_type',value_text=p_data->>'value_text',terms=p_data->>'terms',starts_on=public.ins_date(p_data->>'starts_on'),ends_on=public.ins_date(p_data->>'ends_on'),status=coalesce(p_data->>'status','draft'),updated_at=now() where id=v_id;
 if p_data->>'status' in ('published','paused','archived') then perform public.bd_audit(p_org,'offer_'||(p_data->>'status'));
end if;
return v_id;
end $$;

create function public.save_service_review_response(p_org uuid,p_location uuid,p_review uuid,p_body text,p_status text default 'published') returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid;
begin perform public.ec_authorize(p_org,p_location,true);
perform 1 from public.service_reviews r join public.service_provider_locations l on l.google_place_id=r.google_place_id where r.id=p_review and l.id=p_location and l.organization_id=p_org and r.deleted_at is null and r.hidden_at is null for update of r;
if not found or p_status not in ('published','withdrawn') then raise exception 'Review unavailable';
end if;
 if exists(select 1 from public.service_review_responses where review_id=p_review and (organization_id<>p_org or status='moderated')) then raise exception 'Response unavailable';
end if;
 insert into public.service_review_responses(review_id,organization_id,location_id,created_by,body,status) values(p_review,p_org,p_location,auth.uid(),p_body,p_status) on conflict(review_id) do update set body=excluded.body,status=excluded.status,updated_at=now() returning id into v_id;
perform public.bd_audit(p_org,'review_response_'||p_status);
return v_id;
end $$;

create function public.ec_public_response(p_review uuid) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('responseId',s.id,'body',s.body,'businessName',o.name,'createdAt',s.created_at,'updatedAt',s.updated_at,'sourceLabel','Response from claimed business') from public.service_review_responses s join public.service_provider_organizations o on o.id=s.organization_id join public.service_provider_locations l on l.id=s.location_id join public.service_reviews r on r.id=s.review_id where s.review_id=p_review and s.status='published' and o.status='active' and l.status='active' and l.google_place_id=r.google_place_id and r.deleted_at is null and r.hidden_at is null$$;

create function public.report_service_review_response(p_response uuid,p_reason text,p_details text default null) returns void language plpgsql security definer set search_path='' as $$begin if auth.uid() is null then raise exception 'Sign in to report';
end if;
perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('response-report:'||auth.uid(),0));
if not exists(select 1 from public.service_review_responses where id=p_response and public.ec_public_response(review_id) is not null) then raise exception 'Response unavailable';
end if;
if (select count(*) from public.service_review_response_reports where reporter_id=auth.uid() and created_at>now()-interval '1 day')>=10 then raise exception 'Report limit reached';
end if;
insert into public.service_review_response_reports(reporter_id,response_id,reason,details) values(auth.uid(),p_response,p_reason,p_details) on conflict(reporter_id,response_id) do nothing;
end $$;
-- Preserve review retrieval, order, stars and reviewer pseudonym; only attach a safe response.
alter function public.read_service_reviews(text,integer) rename to ec_original_reviews;
revoke all on function public.ec_original_reviews(text,integer) from public,anon,authenticated;

create function public.read_service_reviews(p_place text,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;
begin d:=public.ec_original_reviews(p_place,p_offset);
return jsonb_set(d,'{reviews}',coalesce((select jsonb_agg(item||jsonb_build_object('response',public.ec_public_response((item->>'id')::uuid)) order by ord) from jsonb_array_elements(d->'reviews') with ordinality a(item,ord)),'[]'));
end $$;

create function public.public_business_ecosystem(p_location uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare l public.service_provider_locations;
begin if not public.ec_published(p_location) then return null;
end if;
select * into l from public.service_provider_locations where id=p_location;
return jsonb_build_object('locationId',l.id,'businessName',(select name from public.service_provider_organizations where id=l.organization_id),'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'quoteRequestAvailable',accepts_quote_requests) order by display_order,name,id) from public.service_provider_services where location_id=l.id and active and accepts_quote_requests),'[]'),'offers',coalesce((select jsonb_agg(jsonb_build_object('offerId',id,'businessName',(select name from public.service_provider_organizations where id=l.organization_id),'locationId',location_id,'title',title,'description',description,'offerType',offer_type,'valueText',value_text,'terms',terms,'startsOn',starts_on,'endsOn',ends_on,'sourceLabel','Offer from claimed business') order by created_at desc,id) from public.service_provider_offers where organization_id=l.organization_id and (location_id is null or location_id=l.id) and status='published' and (starts_on is null or starts_on<=current_date) and (ends_on is null or ends_on>=current_date)),'[]'),'reviews',public.read_service_reviews(l.google_place_id,0));
end $$;

create function public.my_business_ecosystem(p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare r text;
begin r:=public.ec_authorize(p_org);
return jsonb_build_object('role',r,'canManage',r in ('owner','admin'),'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',coalesce(p.display_name,o.name),'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'acceptsQuoteRequests',accepts_quote_requests) order by display_order,id) from public.service_provider_services where location_id=l.id and active),'[]'),'reviews',public.read_service_reviews(l.google_place_id,0))) from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id left join public.service_provider_location_profiles p on p.location_id=l.id where l.organization_id=p_org and public.service_provider_can_access_location(p_org,l.id)),'[]'),'offers',coalesce((select jsonb_agg(to_jsonb(o)-array['created_by','organization_id'] order by created_at desc,id) from (select * from public.service_provider_offers where organization_id=p_org and (location_id is null or public.service_provider_can_access_location(p_org,location_id)) order by created_at desc,id limit 100) o),'[]'),'newQuoteRequests',(select count(*) from public.service_quote_requests where organization_id=p_org and public.service_provider_can_access_location(p_org,location_id) and status='requested' and expires_at>now()),'sentQuotes',(select count(*) from public.service_quote_requests where organization_id=p_org and public.service_provider_can_access_location(p_org,location_id) and status='quoted' and expires_at>now()),'reviewsAwaitingResponse',(select count(*) from public.service_reviews rv join public.service_provider_locations l on l.google_place_id=rv.google_place_id where l.organization_id=p_org and public.service_provider_can_access_location(p_org,l.id) and rv.deleted_at is null and rv.hidden_at is null and not exists(select 1 from public.service_review_responses where review_id=rv.id and status='published')));
end $$;

create function public.ecosystem_dashboard_summary(p_org uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare d jsonb;
begin d:=public.my_business_ecosystem(p_org);
return jsonb_build_object('newRequests',d->'newQuoteRequests','sentQuotes',d->'sentQuotes','awaitingResponse',d->'reviewsAwaitingResponse','publishedOffers',(select count(*) from public.service_provider_offers where organization_id=p_org and status='published' and (location_id is null or public.service_provider_can_access_location(p_org,location_id))),'draftOffers',(select count(*) from public.service_provider_offers where organization_id=p_org and status='draft' and (location_id is null or public.service_provider_can_access_location(p_org,location_id))));
end $$;

create function public.operator_review_response_reports() returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('responseId',response_id,'reason',reason,'details',details,'createdAt',created_at,'body',body,'status',status)),'[]') from (select r.response_id,r.reason,r.details,r.created_at,s.body,s.status from public.service_review_response_reports r join public.service_review_responses s on s.id=r.response_id order by r.created_at desc limit 100) x$$;
-- Operator-only foundation: no rows are seeded; capabilities cannot grant runtime authority.

create function public.operator_save_partner(p_id uuid,p_key text,p_name text,p_type text,p_status text,p_website text default null) returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid;
begin if p_id is null then insert into public.partner_organizations(partner_key,display_name,partner_type,status,website_url) values(p_key,p_name,p_type,p_status,p_website) returning id into v_id;
else update public.partner_organizations set display_name=p_name,partner_type=p_type,status=p_status,website_url=p_website,updated_at=now() where id=p_id and partner_key=p_key returning id into v_id;
if v_id is null then raise exception 'Partner unavailable';
end if;
end if;
return v_id;
end $$;

create function public.operator_save_partner_connection(p_id uuid,p_partner uuid,p_org uuid,p_location uuid,p_household uuid,p_type text,p_ref text,p_status text) returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid;
begin if p_location is not null and not exists(select 1 from public.service_provider_locations where id=p_location and organization_id=p_org) then raise exception 'Invalid partner location';
end if;
if p_status='active' and not exists(select 1 from public.partner_organizations where id=p_partner and status='active') then raise exception 'Partner is not active';
end if;
if p_id is null then insert into public.partner_connections(partner_id,organization_id,location_id,household_id,connection_type,credential_ref,status) values(p_partner,p_org,p_location,p_household,p_type,p_ref,p_status) returning id into v_id;
else update public.partner_connections set credential_ref=p_ref,status=p_status,updated_at=now() where id=p_id and partner_id=p_partner and organization_id is not distinct from p_org and location_id is not distinct from p_location and household_id is not distinct from p_household and connection_type=p_type returning id into v_id;
if v_id is null then raise exception 'Connection unavailable';
end if;
end if;
return v_id;
end $$;

create function public.operator_moderate_review_response(p_response uuid) returns void language plpgsql security definer set search_path='' as $$begin update public.service_review_responses set status='moderated',updated_at=now() where id=p_response;
end $$;
-- Cross-record constraints are independently enforced even in privileged transactions.

create function public.ec_integrity() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_table_name='service_quote_requests' then if not exists(select 1 from public.pets p join public.households h on h.id=p.household_id join public.service_provider_locations l on l.id=new.location_id join public.service_provider_services s on s.location_id=l.id where p.id=new.pet_id and h.id=new.household_id and h.owner_id=new.owner_id and l.organization_id=new.organization_id and s.id=new.service_id) then raise exception 'Invalid request ownership';
end if;
 elsif tg_table_name='service_quotes' then if not exists(select 1 from public.service_quote_requests where id=new.request_id and organization_id=new.organization_id and location_id=new.location_id and service_id=new.service_id) then raise exception 'Invalid quote identity';
end if;
 else if new.location_id is not null and not exists(select 1 from public.service_provider_locations where id=new.location_id and organization_id=new.organization_id) then raise exception 'Invalid business location';
end if;
 if tg_table_name='service_review_responses' then if not exists(select 1 from public.service_reviews r join public.service_provider_locations l on l.google_place_id=r.google_place_id where r.id=new.review_id and l.id=new.location_id) then raise exception 'Invalid review response';
end if;
end if;
end if;
return new;
end $$;
do $$declare t text;
f record;
begin foreach t in array array['service_quote_requests','service_quotes','service_provider_offers','service_review_responses','partner_connections'] loop execute format('create trigger ecosystem_integrity before insert or update on public.%I for each row execute function public.ec_integrity()',t);
end loop;
foreach t in array array['service_quote_requests','service_quotes','service_quote_versions','service_provider_offers','service_review_responses','service_review_response_reports','partner_organizations','partner_connections'] loop execute format('alter table public.%I enable row level security',t);
execute format('revoke all on public.%I from public,anon,authenticated',t);
end loop;
for f in select p.oid::regprocedure sig,p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (left(p.proname,3)='ec_' or p.proname in ('set_service_quote_requests','submit_service_quote_request','withdraw_service_quote_request','my_service_quote_requests','service_provider_quote_requests','send_service_quote','close_service_quote','save_quote_to_planning','set_quote_planning_status','save_service_provider_offer','save_service_review_response','report_service_review_response','public_business_ecosystem','my_business_ecosystem','ecosystem_dashboard_summary','operator_review_response_reports','operator_save_partner','operator_save_partner_connection','operator_moderate_review_response','cost_planned_dto','save_pet_planned_cost','read_service_reviews')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);
if left(f.name,3)<>'ec_' and left(f.name,9)<>'operator_' and f.name<>'cost_planned_dto' then execute format('grant execute on function %s to authenticated',f.sig);
end if;
end loop;
end $$;
grant execute on function public.public_business_ecosystem(uuid),public.read_service_reviews(text,integer) to anon;
grant execute on function public.operator_save_partner(uuid,text,text,text,text,text),public.operator_save_partner_connection(uuid,uuid,uuid,uuid,uuid,text,text,text),public.operator_moderate_review_response(uuid),public.operator_review_response_reports() to pawport_partner_operator;
commit;
