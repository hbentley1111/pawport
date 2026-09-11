begin;

-- Drop only the one-column UNIQUE constraint, retaining the FK and every row.
-- Fail closed if the expected schema has drifted.
do $$
declare restriction name;
begin
 select c.conname into strict restriction from pg_constraint c
 where c.conrelid='public.pets'::regclass and c.contype='u'
 and c.conkey=array[(select attnum from pg_attribute where attrelid='public.pets'::regclass and attname='household_id')];
 execute format('alter table public.pets drop constraint %I', restriction);
end $$;
create index pets_household_id_idx on public.pets(household_id);

-- Serialize inserts on the household row. This applies to direct API inserts too.
create function public.guard_pet_household() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
   if new.id is distinct from old.id or new.household_id is distinct from old.household_id or new.created_at is distinct from old.created_at then
     raise exception 'Pet identity and household cannot be changed';
   end if;
 else
   perform 1 from public.households where id=new.household_id for update;
   if (select count(*) from public.pets where household_id=new.household_id)>=20 then
     raise exception 'Household pet limit reached (20)';
   end if;
 end if;
 return new;
end $$;
create trigger pet_household_guard before insert or update on public.pets for each row execute function public.guard_pet_household();
revoke all on function public.guard_pet_household() from public,anon,authenticated;
grant update(name,species,breed,birth_date,sex,microchip) on public.pets to authenticated;
create policy pet_update on public.pets for update to authenticated
 using(public.owns_health_pet(id))
 with check(exists(select 1 from public.households h where h.id=household_id and h.owner_id=auth.uid()));
-- No DELETE grants or policies are added.

create table public.pet_photo_uploads (
 id uuid primary key default gen_random_uuid(),
 pet_id uuid not null references public.pets(id) on delete cascade,
 object_path text not null unique,
 mime_type text not null check(mime_type in ('image/jpeg','image/png')),
 byte_size integer not null check(byte_size between 1 and 3145728),
 status text not null default 'pending' check(status in ('pending','current','retired')),
 created_at timestamptz not null default now()
);
create index pet_photo_uploads_pet_idx on public.pet_photo_uploads(pet_id);
create unique index pet_photo_one_current on public.pet_photo_uploads(pet_id) where status='current';
alter table public.pets add column photo_id uuid references public.pet_photo_uploads(id);
-- Table-level INSERT from Phase 1 would otherwise allow injecting a photo pointer.
revoke insert on public.pets from authenticated;
grant insert(id,household_id,name,species,breed,birth_date,sex,microchip,created_at) on public.pets to authenticated;
alter table public.pet_photo_uploads enable row level security;
revoke all on public.pet_photo_uploads from public,anon,authenticated;
grant select on public.pet_photo_uploads to authenticated;
create policy pet_photo_owner on public.pet_photo_uploads for select to authenticated using(public.owns_health_pet(pet_id));

create function public.prepare_pet_photo(p_pet uuid,p_name text,p_mime text,p_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare photo uuid:=gen_random_uuid(); home uuid; ext text; path text;
begin
 if not public.owns_health_pet(p_pet) then raise exception 'Not authorized'; end if;
 select household_id into home from public.pets where id=p_pet for update;
 ext:=lower(substring(p_name from '\.([^.]+)$'));
 if p_name is null or length(p_name) not between 1 and 180 or p_name ~ '[[:cntrl:]/\\]' or p_size is null or p_size not between 1 and 3145728
 or p_mime is null or ext is null or not ((p_mime='image/jpeg' and ext in ('jpg','jpeg')) or (p_mime='image/png' and ext='png')) then raise exception 'Invalid photo'; end if;
 if (select count(*) from public.pet_photo_uploads where pet_id=p_pet and status='pending' and created_at>now()-interval '1 hour')>=10 then raise exception 'Too many pending photo uploads. Try again later.'; end if;
 path:=home::text||'/'||p_pet::text||'/'||photo::text||'.'||ext;
 insert into public.pet_photo_uploads(id,pet_id,object_path,mime_type,byte_size) values(photo,p_pet,path,p_mime,p_size);
 return jsonb_build_object('id',photo,'path',path);
end $$;
create function public.finalize_pet_photo(p_photo uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare photo public.pet_photo_uploads; pet uuid; old_path text;
begin
 select pet_id into pet from public.pet_photo_uploads where id=p_photo;
 if pet is null or not public.owns_health_pet(pet) then raise exception 'Not authorized'; end if;
 -- Same lock order as prepare; replacements serialize on this pet.
 perform 1 from public.pets where id=pet for update;
 select * into photo from public.pet_photo_uploads where id=p_photo for update;
 if photo.status='current' then return jsonb_build_object('previous_path',null); end if;
 if photo.status<>'pending' or photo.created_at<=now()-interval '1 hour' then raise exception 'Photo upload expired or replaced'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='pet-photos' and o.name=photo.object_path and (o.metadata->>'size')::bigint=photo.byte_size and o.metadata->>'mimetype'=photo.mime_type) then raise exception 'Photo missing or invalid'; end if;
 select object_path into old_path from public.pet_photo_uploads where pet_id=pet and status='current';
 update public.pet_photo_uploads set status='retired' where pet_id=pet and status='current';
 update public.pet_photo_uploads set status='current' where id=photo.id;
 update public.pets set photo_id=photo.id where id=pet;
 return jsonb_build_object('previous_path',old_path);
end $$;
revoke all on function public.prepare_pet_photo(uuid,text,text,integer),public.finalize_pet_photo(uuid) from public,anon,authenticated;
grant execute on function public.prepare_pet_photo(uuid,text,text,integer),public.finalize_pet_photo(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('pet-photos','pet-photos',false,3145728,array['image/jpeg','image/png']);
create function public.can_access_pet_photo(p_path text,p_operation text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.pet_photo_uploads u
 where u.object_path=p_path and public.owns_health_pet(u.pet_id) and (
 p_operation='read' or
 (p_operation='insert' and u.status='pending' and u.created_at>now()-interval '1 hour') or
 (p_operation='delete' and u.status='retired')));
$$;
revoke all on function public.can_access_pet_photo(text,text) from public,anon,authenticated;
grant execute on function public.can_access_pet_photo(text,text) to anon,authenticated;
create policy pet_photo_read on storage.objects for select to authenticated using(bucket_id='pet-photos' and public.can_access_pet_photo(name,'read'));
create policy pet_photo_insert on storage.objects for insert to authenticated with check(bucket_id='pet-photos' and public.can_access_pet_photo(name,'insert'));
create policy pet_photo_delete on storage.objects for delete to authenticated using(bucket_id='pet-photos' and public.can_access_pet_photo(name,'delete'));
-- Unrelated permissive policies must not open this bucket. Never overwrite objects.
create policy pet_photo_read_guard on storage.objects as restrictive for select to public using(bucket_id<>'pet-photos' or public.can_access_pet_photo(name,'read'));
create policy pet_photo_insert_guard on storage.objects as restrictive for insert to public with check(bucket_id<>'pet-photos' or public.can_access_pet_photo(name,'insert'));
create policy pet_photo_delete_guard on storage.objects as restrictive for delete to public using(bucket_id<>'pet-photos' or public.can_access_pet_photo(name,'delete'));
create policy pet_photo_update_guard on storage.objects as restrictive for update to public using(bucket_id<>'pet-photos') with check(bucket_id<>'pet-photos');
commit;
