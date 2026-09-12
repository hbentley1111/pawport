begin;
-- Business representation is separate from veterinary verification and scheduling authority.
create table public.service_provider_organizations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(btrim(name)) between 1 and 160),
 status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.service_provider_locations (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.service_provider_organizations(id),
 google_place_id text not null unique check(google_place_id ~ '^[A-Za-z0-9_-]{1,255}$'),
 status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Reserve identity even while suspended: suspension must not permit a takeover claim.
create index service_provider_locations_organization on public.service_provider_locations(organization_id);
create table public.service_provider_memberships (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.service_provider_organizations(id),
 user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','admin','staff','scheduling_manager')),
 active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,user_id)
);
create index service_provider_memberships_user on public.service_provider_memberships(user_id,organization_id) where active;
create table public.service_provider_claims (
 id uuid primary key default gen_random_uuid(),
 google_place_id text not null check(google_place_id ~ '^[A-Za-z0-9_-]{1,255}$'),
 requested_by uuid not null references auth.users(id),
 requested_organization_id uuid references public.service_provider_organizations(id),
 organization_name text not null check(length(btrim(organization_name)) between 1 and 160),
 claimant_role text not null check(length(btrim(claimant_role)) between 1 and 100),
 business_email text not null check(length(business_email) between 3 and 254 and position('@' in business_email) between 2 and 65 and business_email !~ '(^\.|\.@|\.\.)' and business_email ~ '^[A-Za-z0-9_+.!#$%&''*=/\?^`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'),
 claim_note text check(length(claim_note)<=1500),
 verification_method text not null default 'manual_review' check(verification_method='manual_review'),
 status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn')),
 reviewer_note text check(length(reviewer_note)<=1500), reviewed_at timestamptz,
 approved_location_id uuid references public.service_provider_locations(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((status in ('pending','withdrawn') and reviewed_at is null and reviewer_note is null and approved_location_id is null) or (status='rejected' and reviewed_at is not null and approved_location_id is null) or (status='approved' and reviewed_at is not null and approved_location_id is not null))
);
create unique index service_provider_claim_pending on public.service_provider_claims(requested_by,google_place_id) where status='pending';
create index service_provider_claim_owner_date on public.service_provider_claims(requested_by,created_at desc,id desc);
create index service_provider_claim_review_queue on public.service_provider_claims(created_at,id) where status='pending';
alter table public.service_provider_organizations enable row level security;
alter table public.service_provider_locations enable row level security;
alter table public.service_provider_memberships enable row level security;
alter table public.service_provider_claims enable row level security;
revoke all on public.service_provider_organizations,public.service_provider_locations,public.service_provider_memberships,public.service_provider_claims from public,anon,authenticated;
-- Supabase may grant service_role through default privileges. This workflow uses its dedicated reviewer role.
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on public.service_provider_organizations,public.service_provider_locations,public.service_provider_memberships,public.service_provider_claims from service_role; end if;end $$;

create function public.guard_service_provider_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.id<>old.id or new.created_at<>old.created_at then raise exception 'Business identity immutable'; end if;
 if tg_table_name='service_provider_locations' then if (new.organization_id,new.google_place_id) is distinct from (old.organization_id,old.google_place_id) then raise exception 'Location identity immutable'; end if; end if;
 if tg_table_name='service_provider_memberships' then if (new.organization_id,new.user_id) is distinct from (old.organization_id,old.user_id) then raise exception 'Membership identity immutable'; end if; end if;
 new.updated_at:=now(); return new;
end $$;
create trigger service_organization_identity before update on public.service_provider_organizations for each row execute function public.guard_service_provider_identity();
create trigger service_location_identity before update on public.service_provider_locations for each row execute function public.guard_service_provider_identity();
create trigger service_membership_identity before update on public.service_provider_memberships for each row execute function public.guard_service_provider_identity();
create function public.guard_service_provider_claim() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.google_place_id,new.requested_by,new.requested_organization_id,new.organization_name,new.claimant_role,new.business_email,new.claim_note,new.verification_method,new.created_at) is distinct from (old.id,old.google_place_id,old.requested_by,old.requested_organization_id,old.organization_name,old.claimant_role,old.business_email,old.claim_note,old.verification_method,old.created_at) then raise exception 'Submitted claim immutable'; end if;
 if old.status<>'pending' then if new is distinct from old then raise exception 'Claim is final'; end if;return old; end if;
 if new.status not in ('approved','rejected','withdrawn') then raise exception 'Invalid claim transition'; end if;
 if new.status='approved' and not exists(select 1 from public.service_provider_locations l where l.id=new.approved_location_id and l.google_place_id=new.google_place_id and (new.requested_organization_id is null or l.organization_id=new.requested_organization_id)) then raise exception 'Invalid approved location'; end if;
 new.updated_at:=now();return new;
end $$;
create trigger service_claim_identity before update on public.service_provider_claims for each row execute function public.guard_service_provider_claim();

create function public.submit_service_provider_claim(p_place text,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid;org_name text;result uuid;
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if p_place is null or p_place !~ '^[A-Za-z0-9_-]{1,255}$' or jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('requested_organization_id','organization_name','claimant_role','business_email','claim_note')) then raise exception 'Invalid claim fields'; end if;
 if octet_length(p_data::text)>16000 or length(p_data->>'organization_name')>160 or length(p_data->>'claimant_role')>100 or length(p_data->>'business_email')>254 or length(p_data->>'claim_note')>1500 then raise exception 'Claim fields too long'; end if;
 if exists(select 1 from jsonb_each(p_data) e where e.value<>'null'::jsonb and jsonb_typeof(e.value)<>'string') then raise exception 'Invalid claim fields'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('claim-user:'||auth.uid()::text,0));
 if (select count(*) from public.service_provider_claims where requested_by=auth.uid() and created_at>=now()-interval '30 days')>=10 then raise exception 'Claim limit reached'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('claim-place:'||p_place,0));
 if exists(select 1 from public.service_provider_locations where google_place_id=p_place) then raise exception 'Listing already claimed'; end if;
 if exists(select 1 from public.service_provider_claims where requested_by=auth.uid() and google_place_id=p_place and status='pending') then raise exception 'Claim already pending'; end if;
 org:=nullif(p_data->>'requested_organization_id','')::uuid;
 org_name:=btrim(p_data->>'organization_name');
 if org is not null then
 select o.name into org_name from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id where o.id=org and o.status='active' and m.user_id=auth.uid() and m.active and m.role in ('owner','admin') for share of o,m;
 if not found then raise exception 'Organization management required'; end if;
 end if;
 insert into public.service_provider_claims(google_place_id,requested_by,requested_organization_id,organization_name,claimant_role,business_email,claim_note)
 values(p_place,auth.uid(),org,org_name,btrim(p_data->>'claimant_role'),btrim(p_data->>'business_email'),nullif(btrim(p_data->>'claim_note'),'')) returning id into result;
 return result;
end $$;
create function public.withdraw_service_provider_claim(p_claim uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.service_provider_claims;
begin
 select * into c from public.service_provider_claims where id=p_claim and requested_by=auth.uid() for update;
 if c.id is null or auth.uid() is null then raise exception 'Not authorized'; end if;
 if c.status='withdrawn' then return; end if;
 if c.status<>'pending' then raise exception 'Only pending claims can be withdrawn'; end if;
 update public.service_provider_claims set status='withdrawn' where id=c.id;
end $$;
-- Intentionally no reviewer endpoint or browser role membership.
do $$ begin if not exists(select 1 from pg_roles where rolname='pawport_claim_reviewer') then create role pawport_claim_reviewer nologin noinherit; end if;end $$;
grant usage on schema public to pawport_claim_reviewer;
create function public.review_service_provider_claim(p_claim uuid,p_decision text,p_reviewer_note text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare c public.service_provider_claims;org uuid;location uuid;
begin
 if p_decision is null or p_decision not in ('approved','rejected') or length(coalesce(p_reviewer_note,''))>1500 then raise exception 'Invalid review'; end if;
 select * into c from public.service_provider_claims where id=p_claim for update;
 if c.id is null then raise exception 'Claim unavailable'; end if;
 if auth.uid()=c.requested_by then raise exception 'Independent review required'; end if;
 if c.status=p_decision then return c.approved_location_id; end if;
 if c.status<>'pending' then raise exception 'Claim is not pending'; end if;
 if p_decision='approved' then
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('claim-place:'||c.google_place_id,0));
 if exists(select 1 from public.service_provider_locations where google_place_id=c.google_place_id) then raise exception 'Listing already claimed'; end if;
 org:=c.requested_organization_id;
 if org is not null then
 perform 1 from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id where o.id=org and o.status='active' and m.user_id=c.requested_by and m.active and m.role in ('owner','admin') for share of o,m;
 if not found then raise exception 'Organization management required'; end if;
 else
 insert into public.service_provider_organizations(name) values(c.organization_name) returning id into org;
 insert into public.service_provider_memberships(organization_id,user_id,role) values(org,c.requested_by,'owner');
 end if;
 insert into public.service_provider_locations(organization_id,google_place_id) values(org,c.google_place_id) returning id into location;
 end if;
 update public.service_provider_claims set status=p_decision,reviewed_at=now(),reviewer_note=nullif(btrim(p_reviewer_note),''),approved_location_id=location where id=c.id;
 return location;
end $$;
create function public.my_service_provider_claims(p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 or (p_before is null)<>(p_before_id is null) or (p_before is not null and not isfinite(p_before)) then raise exception 'Invalid claim page'; end if;
 with selected as(select c.*,row_number() over(order by created_at desc,id desc) seq from public.service_provider_claims c where requested_by=auth.uid() and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit p_limit+1)
 select jsonb_build_object('claims',coalesce((select jsonb_agg(jsonb_build_object('id',id,'googlePlaceId',google_place_id,'organizationName',organization_name,'status',status,'claimantRole',claimant_role,'createdAt',created_at,'reviewedAt',reviewed_at,'participationActive',exists(select 1 from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id where l.id=selected.approved_location_id and l.status='active' and o.status='active')) order by seq) from selected where seq<=p_limit),'[]'::jsonb),'nextCursor',case when exists(select 1 from selected where seq>p_limit) then(select jsonb_build_object('at',created_at,'id',id) from selected where seq=p_limit) end) into result;return result;
end $$;
create function public.my_service_provider_organizations() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from(select o.id,o.name from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id where o.status='active' and m.active and m.user_id=auth.uid() and m.role in ('owner','admin') order by o.name,o.id limit 100)x),'[]'::jsonb);
end $$;
create function public.service_provider_claim_statuses(p_places text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_places is null or cardinality(p_places)>20 or exists(select 1 from unnest(p_places) p where p is null or p !~ '^[A-Za-z0-9_-]{1,255}$') then raise exception 'Invalid listing identifiers'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('googlePlaceId',p,'claimed',coalesce(l.status='active' and o.status='active',false),'claimable',l.id is null,'organizationId',case when l.status='active' and o.status='active' then o.id end,'organizationName',case when l.status='active' and o.status='active' then o.name end) order by p) from(select distinct unnest(p_places) p)x left join public.service_provider_locations l on l.google_place_id=p left join public.service_provider_organizations o on o.id=l.organization_id),'[]'::jsonb);
end $$;
-- A restricted backoffice can read the evidence it reviews without raw table grants.
create function public.service_provider_claim_review_queue(p_claim uuid default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'Invalid review page'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'googlePlaceId',google_place_id,'requestedBy',requested_by,'requestedOrganizationId',requested_organization_id,'organizationName',organization_name,'claimantRole',claimant_role,'businessEmail',business_email,'claimNote',claim_note,'verificationMethod',verification_method,'status',status,'reviewerNote',reviewer_note,'createdAt',created_at,'reviewedAt',reviewed_at) order by created_at,id) from(select * from public.service_provider_claims where (p_claim is null and status='pending') or id=p_claim order by created_at,id limit p_limit)x),'[]'::jsonb);
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('service_provider_claim_review_queue','guard_service_provider_identity','guard_service_provider_claim','submit_service_provider_claim','withdraw_service_provider_claim','review_service_provider_claim','my_service_provider_claims','my_service_provider_organizations','service_provider_claim_statuses') loop execute format('revoke all on function %s from public,anon,authenticated,pawport_claim_reviewer',f.signature);if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on function %s from service_role',f.signature);end if;end loop;end $$;
grant execute on function public.submit_service_provider_claim(text,jsonb),public.withdraw_service_provider_claim(uuid),public.my_service_provider_claims(timestamptz,uuid,integer),public.my_service_provider_organizations() to authenticated;
grant execute on function public.service_provider_claim_statuses(text[]) to anon,authenticated;
grant execute on function public.review_service_provider_claim(uuid,text,text),public.service_provider_claim_review_queue(uuid,integer) to pawport_claim_reviewer;
commit;
