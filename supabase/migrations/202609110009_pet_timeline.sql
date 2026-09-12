begin;
create table public.pet_journal_entries (
 id uuid primary key default gen_random_uuid(),household_id uuid not null references public.households(id),pet_id uuid not null references public.pets(id),created_by uuid not null references auth.users(id),
 entry_type text not null check(entry_type in ('note','milestone','weight','photo','activity','custom')),
 title text check(length(title)<=120),note text check(length(note)<=2000),occurred_at timestamptz not null check(isfinite(occurred_at) and occurred_at>='1900-01-01 00:00:00+00'),
 time_zone text not null check(length(time_zone) between 1 and 100),weight_value numeric,weight_unit text check(weight_unit in ('lb','kg')),
 photo_id uuid references public.pet_photo_uploads(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,
 check((entry_type='weight' and weight_value is not null and weight_unit is not null and weight_value>0 and weight_value<case when weight_unit='lb' then 1000 else 453.59237 end and scale(weight_value)<=3) or (entry_type<>'weight' and weight_value is null and weight_unit is null)),
 check((entry_type='photo' and photo_id is not null) or (entry_type<>'photo' and photo_id is null)),
 check(entry_type<>'milestone' or length(btrim(title))>0 and title is not null),
 check(entry_type in ('weight','photo') or coalesce(length(btrim(title)),0)+coalesce(length(btrim(note)),0)>0)
);
create index journal_pet_history on public.pet_journal_entries(pet_id,occurred_at desc,id desc) where deleted_at is null;
create index journal_photo_references on public.pet_journal_entries(photo_id) where photo_id is not null and deleted_at is null;
create index journal_owner_created on public.pet_journal_entries(created_by,created_at desc);
alter table public.pet_journal_entries enable row level security;
revoke all on public.pet_journal_entries from public,anon,authenticated,pawport_scheduling_worker,pawport_care_worker;
create function public.guard_pet_journal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.pets p join public.households h on h.id=p.household_id where p.id=new.pet_id and h.id=new.household_id and h.owner_id=new.created_by) then raise exception 'Invalid journal ownership'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Invalid time zone'; end if;
 if new.occurred_at>now()+interval '5 minutes' then raise exception 'Choose a past or present moment'; end if;
 if tg_op='UPDATE' then
 if (new.id,new.household_id,new.pet_id,new.created_by,new.entry_type,new.created_at) is distinct from (old.id,old.household_id,old.pet_id,old.created_by,old.entry_type,old.created_at) then raise exception 'Journal identity immutable'; end if;
 if old.deleted_at is not null then raise exception 'Moment deleted'; end if;
 end if;
 if new.photo_id is not null and (tg_op='INSERT' or new.photo_id is distinct from old.photo_id) and not exists(select 1 from public.pet_photo_uploads u where u.id=new.photo_id and u.pet_id=new.pet_id and (u.status in ('current','journal') or (tg_op='UPDATE' and u.id=old.photo_id and u.status='retired')) and exists(select 1 from storage.objects o where o.bucket_id='pet-photos' and o.name=u.object_path)) then raise exception 'Choose a saved photo for this pet'; end if;
 return new;
end $$;
create trigger pet_journal_guard before insert or update on public.pet_journal_entries for each row execute function public.guard_pet_journal();
create function public.save_pet_journal_entry(p_id uuid,p_pet uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid;target uuid;e public.pet_journal_entries;
begin
 if not public.owns_health_pet(p_pet) then raise exception 'Not authorized'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('entry_type','title','note','occurred_at','time_zone','weight_value','weight_unit','photo_id')) then raise exception 'Invalid journal fields'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,9));
 -- Serialize with photo replacement, so retained photos cannot race profile cleanup.
 select household_id into h from public.pets where id=p_pet for update;
 if p_id is null then
 if (select count(*) from public.pet_journal_entries where created_by=auth.uid() and created_at>=now()-interval '1 day')>=50 then raise exception 'Daily moment limit reached'; end if;
 insert into public.pet_journal_entries(household_id,pet_id,created_by,entry_type,title,note,occurred_at,time_zone,weight_value,weight_unit,photo_id)
 values(h,p_pet,auth.uid(),p_data->>'entry_type',nullif(btrim(p_data->>'title'),''),nullif(btrim(p_data->>'note'),''),(p_data->>'occurred_at')::timestamptz,p_data->>'time_zone',(p_data->>'weight_value')::numeric,p_data->>'weight_unit',(p_data->>'photo_id')::uuid) returning id into target;
 else
 select * into e from public.pet_journal_entries where id=p_id and pet_id=p_pet and created_by=auth.uid() and deleted_at is null for update;
 if e.id is null then raise exception 'Moment unavailable'; end if;
 update public.pet_journal_entries set entry_type=p_data->>'entry_type',title=nullif(btrim(p_data->>'title'),''),note=nullif(btrim(p_data->>'note'),''),occurred_at=(p_data->>'occurred_at')::timestamptz,time_zone=p_data->>'time_zone',weight_value=(p_data->>'weight_value')::numeric,weight_unit=p_data->>'weight_unit',photo_id=(p_data->>'photo_id')::uuid,updated_at=now() where id=p_id;target:=p_id;
 end if;return target;
end $$;
create function public.delete_pet_journal_entry(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.pet_journal_entries set deleted_at=now(),updated_at=now() where id=p_id and created_by=auth.uid() and deleted_at is null;
 if not found and not exists(select 1 from public.pet_journal_entries where id=p_id and created_by=auth.uid()) then raise exception 'Not authorized'; end if;
end $$;
create function public.my_pet_journal_entry(p_pet uuid,p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'entry_type',entry_type,'title',title,'note',note,'occurred_at',occurred_at,'time_zone',time_zone,'weight_value',weight_value,'weight_unit',weight_unit,'photo_id',photo_id) from public.pet_journal_entries where id=p_id and pet_id=p_pet and public.owns_health_pet(pet_id) and deleted_at is null;
$$;
-- Reuse existing private photo rows/bucket; a journal upload does not replace pets.photo_id.
alter table public.pet_photo_uploads drop constraint pet_photo_uploads_status_check;
alter table public.pet_photo_uploads add constraint pet_photo_uploads_status_check check(status in ('pending','current','retired','journal'));
create function public.finalize_journal_photo(p_photo uuid) returns void language plpgsql security definer set search_path='' as $$
declare u public.pet_photo_uploads;pet uuid;
begin
 select pet_id into pet from public.pet_photo_uploads where id=p_photo;
 if not public.owns_health_pet(pet) then raise exception 'Not authorized'; end if;
 perform 1 from public.pets where id=pet for update;
 select * into u from public.pet_photo_uploads where id=p_photo for update;
 if u.status='journal' then return; end if;
 if u.status<>'pending' or u.created_at<=now()-interval '1 hour' then raise exception 'Upload expired'; end if;
 if (select count(*) from public.pet_photo_uploads where pet_id=pet and status='journal' and created_at>now()-interval '1 day')>=50 then raise exception 'Daily photo limit reached'; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='pet-photos' and o.name=u.object_path and (o.metadata->>'size')::bigint=u.byte_size and o.metadata->>'mimetype'=u.mime_type) then raise exception 'Photo missing or invalid'; end if;
 update public.pet_photo_uploads set status='journal' where id=p_photo;
end $$;
create or replace function public.can_access_pet_photo(p_path text,p_operation text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.pet_photo_uploads u where u.object_path=p_path and public.owns_health_pet(u.pet_id) and (
 p_operation='read' or (p_operation='insert' and u.status='pending' and u.created_at>now()-interval '1 hour') or
 (p_operation='delete' and u.status='retired' and not exists(select 1 from public.pet_journal_entries j where j.photo_id=u.id and j.deleted_at is null))));
$$;
create or replace function public.finalize_pet_photo(p_photo uuid) returns jsonb
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
 if exists(select 1 from public.pet_journal_entries j join public.pet_photo_uploads u on u.id=j.photo_id where u.object_path=old_path and j.deleted_at is null) then old_path:=null; end if;
 return jsonb_build_object('previous_path',old_path);
end $$;
-- Existing pet indexes bound most source scans. Verification needs a vaccination-key history index
-- (the existing partial unique index omits revoked/cancelled requests).
create index verification_timeline_lookup on public.verification_requests(vaccination_id,requested_at desc,id desc);
create index care_timeline_plan on public.care_plan_occurrences(plan_id,completed_at desc,skipped_at desc) where status in ('completed','skipped');
create function public.my_pet_timeline(p_pet uuid,p_filter text default 'all',p_before timestamptz default null,p_before_id text default null,p_limit integer default 25) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.owns_health_pet(p_pet) then raise exception 'Not authorized'; end if;
 if p_filter is null or p_filter not in ('all','health','care','appointments','life') or p_limit is null or p_limit<1 or p_limit>50 or (p_before is null)<>(p_before_id is null) or (p_before is not null and (not isfinite(p_before) or length(p_before_id) not between 1 and 120)) then raise exception 'Invalid timeline query'; end if;
 with events as (
 select 'care:'||o.id::text||':'||o.status id,'care' source_type,o.id source_id,coalesce(o.completed_at,o.skipped_at) occurred_at,'care_'||o.status event_type,o.title_snapshot||' '||o.status title,'Owner-entered care routine' subtitle,o.completion_note description,null::text trust_state,'care' category,'/care/plans/'||p.id::text action_url,null::text photo_url,jsonb_build_object('careCategory',o.category_snapshot,'timeZone',o.time_zone_snapshot) metadata
 from public.care_plans p join public.care_plan_occurrences o on o.plan_id=p.id where p.pet_id=p_pet and o.status in ('completed','skipped') and p_filter in ('all','care')
 union all
 select 'appointment:'||a.id::text||':'||a.status,'appointment',a.id,case when a.status='completed' then coalesce(a.ends_at,a.starts_at) else a.updated_at end,'appointment_'||a.status,a.title||' '||a.status,a.provider_name,case when a.source='external' then 'Synced from provider' else 'Owner-entered appointment' end,null,'appointments','/appointments/'||a.id::text,null,jsonb_build_object('appointmentType',a.appointment_type,'timeZone',a.time_zone)
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
do $$ declare f record; begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_pet_journal','save_pet_journal_entry','delete_pet_journal_entry','my_pet_journal_entry','finalize_journal_photo','my_pet_timeline') loop execute format('revoke all on function %s from public,anon,authenticated,pawport_care_worker,pawport_scheduling_worker',f.signature);end loop;end $$;
grant execute on function public.save_pet_journal_entry(uuid,uuid,jsonb),public.delete_pet_journal_entry(uuid),public.my_pet_journal_entry(uuid,uuid),public.finalize_journal_photo(uuid),public.my_pet_timeline(uuid,text,timestamptz,text,integer) to authenticated;
commit;
