begin;
-- All profile content is entered by a business representative. Google content is never imported.
create function public.bp_url(v text) returns boolean language sql immutable set search_path='' as $$select v is null or (length(v)<=2048 and v ~* '^https?://[^[:space:]/?#@:]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' and v !~ '[\\[:cntrl:]]')$$;
create function public.bp_email(v text) returns boolean language sql immutable set search_path='' as $$select v is null or (length(v)<=254 and v ~ '^[^[:space:]@]+@[^[:space:]@.]+(\.[^[:space:]@.]+)+$')$$;
create function public.bp_phone(v text) returns boolean language sql immutable set search_path='' as $$select v is null or (length(v)<=40 and v ~ '^[0-9+(). xX#-]+$')$$;
create table public.service_provider_organization_profiles (
 organization_id uuid primary key references public.service_provider_organizations(id),
 tagline text check(length(tagline)<=160), description text check(length(description)<=3000),
 website_url text check(public.bp_url(website_url)), public_email text check(public.bp_email(public_email)), public_phone text check(public.bp_phone(public_phone)),
 logo_asset_id uuid, updated_by uuid references auth.users(id), created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.service_provider_location_profiles (
 location_id uuid primary key references public.service_provider_locations(id),
 display_name text check(length(display_name)<=160),address_line1 text check(length(address_line1)<=160),address_line2 text check(length(address_line2)<=160),
 city text check(length(city)<=100),region text check(length(region)<=100),postal_code text check(length(postal_code)<=30),country_code text check(country_code ~ '^[A-Z]{2}$'),
 public_phone text check(public.bp_phone(public_phone)),website_url text check(public.bp_url(website_url)),time_zone text,
 profile_status text not null default 'draft' check(profile_status in ('draft','published','unpublished')),
 -- false = not provided; true + no row on a day = explicitly closed.
 hours_provided boolean not null default false,
 updated_by uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.service_provider_location_hours (
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.service_provider_locations(id),
 day_of_week integer not null check(day_of_week between 0 and 6),slot integer not null check(slot between 1 and 2),
 opens_at time,closes_at time,is_24_hours boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(location_id,day_of_week,slot),
 check((is_24_hours and opens_at is null and closes_at is null) or (not is_24_hours and opens_at is not null and closes_at is not null and opens_at<closes_at and closes_at<time '24:00'))
);
create table public.service_provider_services (
 id uuid primary key default gen_random_uuid(),location_id uuid not null references public.service_provider_locations(id),
 category text not null check(category in ('veterinary','emergency_veterinary','grooming','walking','sitting','boarding','training','daycare','retail','other')),
 name text not null check(length(btrim(name)) between 1 and 120),description text check(length(description)<=500),active boolean not null default true,
 display_order integer not null default 0 check(display_order between 0 and 1000),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index service_provider_services_location_order on public.service_provider_services(location_id,display_order,id) where active;
create table public.service_provider_assets (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.service_provider_organizations(id),uploaded_by uuid not null references auth.users(id),
 kind text not null default 'logo' check(kind='logo'),object_path text not null unique,mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 byte_size integer not null check(byte_size between 1 and 3145728),status text not null default 'pending' check(status in ('pending','current','retired')),created_at timestamptz not null default now(),
 unique(organization_id,id),check(object_path='logos/'||id::text)
);
create unique index service_provider_one_logo on public.service_provider_assets(organization_id) where status='current';
create index service_provider_asset_pending on public.service_provider_assets(organization_id,created_at) where status='pending';
alter table public.service_provider_organization_profiles add constraint service_provider_logo_org foreign key(organization_id,logo_asset_id) references public.service_provider_assets(organization_id,id);
-- Locks serialize management with membership revocation and business suspension.
create function public.bp_authorize(p_org uuid,p_location uuid default null,p_edit boolean default true) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized';end if;
 perform 1 from public.service_provider_organizations where id=p_org and status='active' for update;
 if not found then raise exception 'Business unavailable';end if;
 perform 1 from public.service_provider_memberships where organization_id=p_org and user_id=auth.uid() and active and (not p_edit or role in ('owner','admin')) for share;
 if not found then raise exception 'Not authorized';end if;
 if p_location is not null then
 perform 1 from public.service_provider_locations where id=p_location and organization_id=p_org and status='active' for update;
 if not found then raise exception 'Location unavailable';end if;end if;
end $$;
create function public.bp_object(p_data jsonb,p_keys text[],p_max integer default 16000) returns void language plpgsql set search_path='' as $$
begin
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>p_max or exists(select 1 from jsonb_object_keys(p_data) k where not k=any(p_keys)) then raise exception 'Invalid profile fields';end if;
end $$;
create function public.bp_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
 if new.created_at<>old.created_at then raise exception 'Identity immutable';end if;
 if tg_table_name='service_provider_organization_profiles' then if new.organization_id<>old.organization_id then raise exception 'Identity immutable';end if;
 elsif tg_table_name='service_provider_assets' then
 if (new.id,new.organization_id,new.uploaded_by,new.object_path,new.mime_type,new.byte_size) is distinct from (old.id,old.organization_id,old.uploaded_by,old.object_path,old.mime_type,old.byte_size) then raise exception 'Asset identity immutable';end if;
 else if new.location_id<>old.location_id then raise exception 'Location identity immutable';end if;end if;
 end if;
 if tg_table_name='service_provider_location_profiles' then
 if new.time_zone is not null and (length(new.time_zone)>100 or not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone)) then raise exception 'Invalid timezone';end if;
 end if;
 if tg_table_name<>'service_provider_assets' then new.updated_at:=now();end if;
 return new;
end $$;
create function public.save_service_provider_organization_profile(p_organization uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.bp_authorize(p_organization);
 perform public.bp_object(p_data,array['name','tagline','description','website_url','public_email','public_phone']);
 if exists(select 1 from jsonb_each(p_data) x where jsonb_typeof(x.value) not in ('string','null')) then raise exception 'Invalid text';end if;
 update public.service_provider_organizations set name=btrim(p_data->>'name') where id=p_organization;
 insert into public.service_provider_organization_profiles(organization_id,tagline,description,website_url,public_email,public_phone,updated_by)
 values(p_organization,nullif(btrim(p_data->>'tagline'),''),nullif(btrim(p_data->>'description'),''),nullif(btrim(p_data->>'website_url'),''),nullif(btrim(p_data->>'public_email'),''),nullif(btrim(p_data->>'public_phone'),''),auth.uid())
 on conflict(organization_id) do update set tagline=excluded.tagline,description=excluded.description,website_url=excluded.website_url,public_email=excluded.public_email,public_phone=excluded.public_phone,updated_by=auth.uid();
end $$;
create function public.save_service_provider_location_profile(p_organization uuid,p_location uuid,p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.bp_authorize(p_organization,p_location);
 perform public.bp_object(p_data,array['display_name','address_line1','address_line2','city','region','postal_code','country_code','public_phone','website_url','time_zone']);
 if exists(select 1 from jsonb_each(p_data) x where jsonb_typeof(x.value) not in ('string','null')) then raise exception 'Invalid text';end if;
 insert into public.service_provider_location_profiles(location_id,display_name,address_line1,address_line2,city,region,postal_code,country_code,public_phone,website_url,time_zone,updated_by)
 values(p_location,nullif(btrim(p_data->>'display_name'),''),nullif(btrim(p_data->>'address_line1'),''),nullif(btrim(p_data->>'address_line2'),''),nullif(btrim(p_data->>'city'),''),nullif(btrim(p_data->>'region'),''),nullif(btrim(p_data->>'postal_code'),''),nullif(btrim(p_data->>'country_code'),''),nullif(btrim(p_data->>'public_phone'),''),nullif(btrim(p_data->>'website_url'),''),nullif(btrim(p_data->>'time_zone'),''),auth.uid())
 on conflict(location_id) do update set display_name=excluded.display_name,address_line1=excluded.address_line1,address_line2=excluded.address_line2,city=excluded.city,region=excluded.region,postal_code=excluded.postal_code,country_code=excluded.country_code,public_phone=excluded.public_phone,website_url=excluded.website_url,time_zone=excluded.time_zone,updated_by=auth.uid();
end $$;
create function public.replace_service_provider_location_hours(p_organization uuid,p_location uuid,p_hours jsonb,p_provided boolean) returns void language plpgsql security definer set search_path='' as $$
declare r jsonb;begin
 perform public.bp_authorize(p_organization,p_location);
 if p_hours is null or jsonb_typeof(p_hours)<>'array' or jsonb_array_length(p_hours)>14 or octet_length(p_hours::text)>6000 or p_provided is null or (not p_provided and jsonb_array_length(p_hours)>0) then raise exception 'Invalid hours';end if;
 delete from public.service_provider_location_hours where location_id=p_location;
 for r in select value from jsonb_array_elements(p_hours) loop
 perform public.bp_object(r,array['day_of_week','slot','opens_at','closes_at','is_24_hours'],500);
 if (r->>'opens_at' is not null and r->>'opens_at' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') or (r->>'closes_at' is not null and r->>'closes_at' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'Invalid clock time';end if;
 insert into public.service_provider_location_hours(location_id,day_of_week,slot,opens_at,closes_at,is_24_hours) values(p_location,(r->>'day_of_week')::integer,(r->>'slot')::integer,(r->>'opens_at')::time,(r->>'closes_at')::time,coalesce((r->>'is_24_hours')::boolean,false));
 end loop;
 if exists(select 1 from public.service_provider_location_hours a join public.service_provider_location_hours b on a.location_id=b.location_id and a.day_of_week=b.day_of_week and a.id<>b.id where a.location_id=p_location and (a.is_24_hours or b.is_24_hours or (a.opens_at<b.closes_at and b.opens_at<a.closes_at))) then raise exception 'Hours overlap or conflict with 24 hours';end if;
 insert into public.service_provider_location_profiles(location_id,hours_provided,updated_by) values(p_location,p_provided,auth.uid()) on conflict(location_id) do update set hours_provided=p_provided,updated_by=auth.uid();
end $$;
create function public.save_service_provider_service(p_organization uuid,p_location uuid,p_service uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid;begin
 perform public.bp_authorize(p_organization,p_location);
 perform public.bp_object(p_data,array['category','name','description','display_order'],3000);
 if exists(select 1 from jsonb_each(p_data) x where (x.key<>'display_order' and jsonb_typeof(x.value) not in ('string','null')) or (x.key='display_order' and jsonb_typeof(x.value)<>'number')) then raise exception 'Invalid service fields';end if;
 if p_service is null then
 if (select count(*) from public.service_provider_services where location_id=p_location and active)>=50 then raise exception 'Maximum 50 active services';end if;
 insert into public.service_provider_services(location_id,category,name,description,display_order) values(p_location,p_data->>'category',btrim(p_data->>'name'),nullif(btrim(p_data->>'description'),''),coalesce((p_data->>'display_order')::integer,0)) returning id into v;
 else
 update public.service_provider_services set category=p_data->>'category',name=btrim(p_data->>'name'),description=nullif(btrim(p_data->>'description'),''),display_order=coalesce((p_data->>'display_order')::integer,0) where id=p_service and location_id=p_location and active returning id into v;
 if not found then raise exception 'Service unavailable';end if;
 end if;return v;
end $$;
create function public.archive_service_provider_service(p_organization uuid,p_location uuid,p_service uuid) returns void language plpgsql security definer set search_path='' as $$
begin perform public.bp_authorize(p_organization,p_location);update public.service_provider_services set active=false where id=p_service and location_id=p_location;if not found then raise exception 'Service unavailable';end if;end $$;
create function public.set_service_provider_profile_status(p_organization uuid,p_location uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.bp_authorize(p_organization,p_location);
 if p_status is null or p_status not in ('published','unpublished') then raise exception 'Invalid publication status';end if;
 insert into public.service_provider_location_profiles(location_id,profile_status,updated_by) values(p_location,p_status,auth.uid()) on conflict(location_id) do update set profile_status=p_status,updated_by=auth.uid();
end $$;
-- Central explicit DTO builder reused for private preview and public reads. Not directly callable.
create function public.bp_profile(p_location uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('locationId',l.id,'googlePlaceId',l.google_place_id,'businessName',o.name,'locationName',lp.display_name,'claimed',true,'tagline',op.tagline,'description',op.description,
 'websiteUrl',coalesce(lp.website_url,op.website_url),'publicPhone',coalesce(lp.public_phone,op.public_phone),'publicEmail',op.public_email,
 'address',jsonb_build_object('line1',lp.address_line1,'line2',lp.address_line2,'city',lp.city,'region',lp.region,'postalCode',lp.postal_code,'countryCode',lp.country_code),
 'timeZone',lp.time_zone,'hoursProvided',coalesce(lp.hours_provided,false),
 'hours',coalesce((select jsonb_agg(jsonb_build_object('day_of_week',day_of_week,'slot',slot,'opens_at',to_char(opens_at,'HH24:MI'),'closes_at',to_char(closes_at,'HH24:MI'),'is_24_hours',is_24_hours) order by day_of_week,slot) from public.service_provider_location_hours where location_id=l.id),'[]'::jsonb),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'category',category,'name',name,'description',description,'display_order',display_order) order by display_order,id) from public.service_provider_services where location_id=l.id and active),'[]'::jsonb),
 'logoUrl',case when op.logo_asset_id is not null then '/providers/'||l.id||'/logo' end,'sourceLabel','Business-provided information')
 from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id left join public.service_provider_organization_profiles op on op.organization_id=o.id left join public.service_provider_location_profiles lp on lp.location_id=l.id where l.id=p_location
$$;
create function public.service_provider_public_profile(p_location uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select public.bp_profile(l.id) from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id join public.service_provider_location_profiles p on p.location_id=l.id where l.id=p_location and l.status='active' and o.status='active' and p.profile_status='published'
$$;
create function public.service_provider_public_profile_for_place(p_place text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if p_place is null or p_place !~ '^[A-Za-z0-9_-]{1,255}$' then raise exception 'Invalid Place ID';end if;return (select public.service_provider_public_profile(id) from public.service_provider_locations where google_place_id=p_place);end $$;
create function public.my_service_provider_businesses() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Not authorized';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'status',x.status,'role',x.role,'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.display_name,'status',l.status,'profileStatus',coalesce(l.profile_status,'draft')) order by l.id) from(select l.id,l.status,p.display_name,p.profile_status from public.service_provider_locations l left join public.service_provider_location_profiles p on p.location_id=l.id where l.organization_id=x.id order by l.id limit 100)l),'[]'::jsonb)) order by x.name,x.id) from(select o.id,o.name,o.status,m.role from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id where m.user_id=auth.uid() and m.active order by o.name,o.id limit 100)x),'[]'::jsonb);end $$;
create function public.service_provider_profile_editor(p_organization uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 perform public.bp_authorize(p_organization,null,false);
 select jsonb_build_object('id',o.id,'name',o.name,'canEdit',m.role in ('owner','admin'),'tagline',p.tagline,'description',p.description,'website_url',p.website_url,'public_email',p.public_email,'public_phone',p.public_phone,
 'logoUrl',case when p.logo_asset_id is not null then '/provider/businesses/'||o.id||'/logo' end,
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'status',l.status,'profileStatus',coalesce(l.profile_status,'draft'),'fields',jsonb_build_object('display_name',l.display_name,'address_line1',l.address_line1,'address_line2',l.address_line2,'city',l.city,'region',l.region,'postal_code',l.postal_code,'country_code',l.country_code,'public_phone',l.public_phone,'website_url',l.website_url,'time_zone',l.time_zone),'preview',public.bp_profile(l.id)) order by l.id) from(select l.id,l.status,p.* from public.service_provider_locations l left join public.service_provider_location_profiles p on p.location_id=l.id where l.organization_id=o.id order by l.id limit 100)l),'[]'::jsonb)) into result
 from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id and m.user_id=auth.uid() and m.active left join public.service_provider_organization_profiles p on p.organization_id=o.id where o.id=p_organization;
 return result;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('provider-profile-assets','provider-profile-assets',false,3145728,array['image/jpeg','image/png','image/webp']);
create function public.prepare_service_provider_logo(p_organization uuid,p_name text,p_mime text,p_size integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v uuid:=gen_random_uuid();begin
 perform public.bp_authorize(p_organization);
 if p_name is null or length(p_name)>255 or p_size is null or p_size not between 1 and 3145728 or p_mime is null or not ((p_mime='image/jpeg' and p_name ~* '\.(jpg|jpeg)$') or (p_mime='image/png' and p_name ~* '\.png$') or (p_mime='image/webp' and p_name ~* '\.webp$')) then raise exception 'Invalid logo file';end if;
 update public.service_provider_assets set status='retired' where organization_id=p_organization and status='pending' and created_at<now()-interval '1 hour';
 if (select count(*) from public.service_provider_assets where organization_id=p_organization and created_at>now()-interval '1 day')>=20 then raise exception 'Logo upload limit reached';end if;
 insert into public.service_provider_assets(id,organization_id,uploaded_by,object_path,mime_type,byte_size) values(v,p_organization,auth.uid(),'logos/'||v,p_mime,p_size);
 return jsonb_build_object('id',v,'path','logos/'||v);
end $$;
create function public.finalize_service_provider_logo(p_organization uuid,p_asset uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.service_provider_assets;begin
 perform public.bp_authorize(p_organization);
 select * into a from public.service_provider_assets where id=p_asset and organization_id=p_organization for update;
 if not found then raise exception 'Logo unavailable';end if;
 if a.status='current' then return;end if;
 if a.status<>'pending' or a.created_at<now()-interval '1 hour' then raise exception 'Logo upload expired';end if;
 if not exists(select 1 from storage.objects where bucket_id='provider-profile-assets' and name=a.object_path and metadata->>'mimetype'=a.mime_type and (metadata->>'size')::bigint=a.byte_size) then raise exception 'Logo missing or invalid';end if;
 update public.service_provider_assets set status='retired' where organization_id=p_organization and status='current';
 update public.service_provider_assets set status='current' where id=p_asset;
 insert into public.service_provider_organization_profiles(organization_id,logo_asset_id,updated_by) values(p_organization,p_asset,auth.uid()) on conflict(organization_id) do update set logo_asset_id=p_asset,updated_by=auth.uid();
end $$;
-- Returns only an opaque asset key and bounded content metadata, never a raw path.
create function public.service_provider_logo_delivery(p_location uuid default null,p_organization uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_org uuid;begin
 if p_location is not null then
 select l.organization_id into v_org from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id join public.service_provider_location_profiles p on p.location_id=l.id where l.id=p_location and l.status='active' and o.status='active' and p.profile_status='published';
 elsif p_organization is not null and auth.uid() is not null then
 select o.id into v_org from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id where o.id=p_organization and o.status='active' and m.user_id=auth.uid() and m.active;
 end if;
 return(select jsonb_build_object('key',a.id,'mime',a.mime_type,'size',a.byte_size) from public.service_provider_organization_profiles p join public.service_provider_assets a on a.id=p.logo_asset_id and a.organization_id=p.organization_id where p.organization_id=v_org and a.status='current');
end $$;
create function public.can_access_service_provider_asset(p_path text,p_action text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.service_provider_assets a join public.service_provider_organizations o on o.id=a.organization_id where a.object_path=p_path and o.status='active' and (
 (p_action='read' and exists(select 1 from public.service_provider_memberships m where m.organization_id=o.id and m.user_id=auth.uid() and m.active and m.role in ('owner','admin')))
 or (p_action='read' and a.status='current' and (exists(select 1 from public.service_provider_memberships m where m.organization_id=o.id and m.user_id=auth.uid() and m.active) or exists(select 1 from public.service_provider_locations l join public.service_provider_location_profiles p on p.location_id=l.id where l.organization_id=o.id and l.status='active' and p.profile_status='published')))
 or (p_action in ('insert','delete') and exists(select 1 from public.service_provider_memberships m where m.organization_id=o.id and m.user_id=auth.uid() and m.active and m.role in ('owner','admin')) and ((p_action='insert' and a.status='pending' and a.created_at>now()-interval '1 hour') or (p_action='delete' and a.status='retired')))))
$$;
create policy provider_asset_read on storage.objects for select to anon,authenticated using(bucket_id='provider-profile-assets' and public.can_access_service_provider_asset(name,'read'));
create policy provider_asset_insert on storage.objects for insert to authenticated with check(bucket_id='provider-profile-assets' and public.can_access_service_provider_asset(name,'insert'));
create policy provider_asset_delete on storage.objects for delete to authenticated using(bucket_id='provider-profile-assets' and public.can_access_service_provider_asset(name,'delete'));
create policy provider_asset_read_guard on storage.objects as restrictive for select to public using(bucket_id<>'provider-profile-assets' or public.can_access_service_provider_asset(name,'read'));
create policy provider_asset_insert_guard on storage.objects as restrictive for insert to public with check(bucket_id<>'provider-profile-assets' or public.can_access_service_provider_asset(name,'insert'));
create policy provider_asset_delete_guard on storage.objects as restrictive for delete to public using(bucket_id<>'provider-profile-assets' or public.can_access_service_provider_asset(name,'delete'));
create policy provider_asset_update_guard on storage.objects as restrictive for update to public using(bucket_id<>'provider-profile-assets') with check(bucket_id<>'provider-profile-assets');
alter table public.service_provider_organization_profiles enable row level security;
revoke all on public.service_provider_organization_profiles from public,anon,authenticated;
create trigger service_provider_organization_profiles_guard before insert or update on public.service_provider_organization_profiles for each row execute function public.bp_guard();
alter table public.service_provider_location_profiles enable row level security;
revoke all on public.service_provider_location_profiles from public,anon,authenticated;
create trigger service_provider_location_profiles_guard before insert or update on public.service_provider_location_profiles for each row execute function public.bp_guard();
alter table public.service_provider_location_hours enable row level security;
revoke all on public.service_provider_location_hours from public,anon,authenticated;
create trigger service_provider_location_hours_guard before insert or update on public.service_provider_location_hours for each row execute function public.bp_guard();
alter table public.service_provider_services enable row level security;
revoke all on public.service_provider_services from public,anon,authenticated;
create trigger service_provider_services_guard before insert or update on public.service_provider_services for each row execute function public.bp_guard();
alter table public.service_provider_assets enable row level security;
revoke all on public.service_provider_assets from public,anon,authenticated;
create trigger service_provider_assets_guard before insert or update on public.service_provider_assets for each row execute function public.bp_guard();
do $$ declare f record;t text;begin
foreach t in array array['service_provider_organization_profiles','service_provider_location_profiles','service_provider_location_hours','service_provider_services','service_provider_assets'] loop if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on public.%I from service_role',t);end if;end loop;
for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['bp_url','bp_email','bp_phone','bp_authorize','bp_object','bp_guard','save_service_provider_organization_profile','save_service_provider_location_profile','replace_service_provider_location_hours','save_service_provider_service','archive_service_provider_service','set_service_provider_profile_status','bp_profile','service_provider_public_profile','service_provider_public_profile_for_place','my_service_provider_businesses','service_provider_profile_editor','prepare_service_provider_logo','finalize_service_provider_logo','service_provider_logo_delivery','can_access_service_provider_asset']) loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on function %s from service_role',f.signature);end if;end loop;end $$;
grant execute on function public.save_service_provider_organization_profile(uuid,jsonb),public.save_service_provider_location_profile(uuid,uuid,jsonb),public.replace_service_provider_location_hours(uuid,uuid,jsonb,boolean),public.save_service_provider_service(uuid,uuid,uuid,jsonb),public.archive_service_provider_service(uuid,uuid,uuid),public.set_service_provider_profile_status(uuid,uuid,text),public.my_service_provider_businesses(),public.service_provider_profile_editor(uuid),public.prepare_service_provider_logo(uuid,text,text,integer),public.finalize_service_provider_logo(uuid,uuid) to authenticated;
grant execute on function public.service_provider_public_profile(uuid),public.service_provider_public_profile_for_place(text),public.service_provider_logo_delivery(uuid,uuid),public.can_access_service_provider_asset(text,text) to anon,authenticated;
-- Existing restrictive health guard references a private table directly. PostgreSQL
-- checks its SELECT privilege even for an unrelated bucket. Preserve its exact
-- predicate behind a definer helper so anonymous published-logo reads do not
-- require ANY health-document grants.
create function public.bp_health_storage_read_guard(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.health_documents d where d.object_path=p_path and d.uploaded_at is not null and public.can_read_health_document(d.id))
$$;
revoke all on function public.bp_health_storage_read_guard(text) from public;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.bp_health_storage_read_guard(text) from service_role;end if;end $$;
grant execute on function public.bp_health_storage_read_guard(text) to anon,authenticated;
alter policy health_document_read_guard on storage.objects using(bucket_id<>'health-documents' or public.bp_health_storage_read_guard(name));
commit;
