begin;
-- Manual care records, isolated from health records and provider verification.
create table public.appointments (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 pet_id uuid not null references public.pets(id) on delete cascade,
 created_by uuid not null references auth.users(id) on delete cascade,
 source text not null default 'manual' check(source in ('manual','pawport','external')),
 external_system text check(length(external_system) between 1 and 80),
 external_connection_id uuid,
 external_appointment_id text check(length(external_appointment_id) between 1 and 255),
 google_place_id text check(google_place_id is null or (length(google_place_id) between 1 and 255 and google_place_id ~ '^[A-Za-z0-9_-]+$')),
 provider_name text check(length(provider_name)<=160),
 appointment_type text not null check(appointment_type in ('veterinary','emergency_vet','grooming','boarding','daycare','walker','sitter','training','medication_followup','vaccination','dental','other')),
 title text not null check(length(btrim(title)) between 1 and 120),
 starts_at timestamptz not null check(starts_at >= '1900-01-01 UTC' and starts_at < '2200-01-01 UTC' and isfinite(starts_at)),
 ends_at timestamptz check(ends_at is null or (isfinite(ends_at) and ends_at>starts_at and ends_at<='2200-01-01 UTC')),
 time_zone text not null default 'UTC' check(length(time_zone) between 1 and 100),
 status text not null default 'scheduled' check(status in ('scheduled','confirmed','requested','waitlisted','cancelled','completed')),
 notes text check(length(notes)<=2000),
 location_text text check(length(location_text)<=300),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((source='external' and external_system is not null and external_connection_id is not null and external_appointment_id is not null)
   or (source<>'external' and external_system is null and external_connection_id is null and external_appointment_id is null))
);
create unique index appointment_external_identity on public.appointments(household_id,external_system,external_connection_id,external_appointment_id) where source='external';
create index appointments_household_time on public.appointments(household_id,starts_at,id);
create index appointments_pet_time on public.appointments(pet_id,starts_at,id);
create table public.appointment_reminders (
 id uuid primary key default gen_random_uuid(),
 appointment_id uuid not null references public.appointments(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 reminder_minutes integer not null check(reminder_minutes in (120,1440,10080)),
 channel text not null default 'in_app' check(channel in ('in_app','email','push')),
 sent_at timestamptz,
 dismissed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(appointment_id,channel,reminder_minutes)
);
create index appointment_reminders_owner on public.appointment_reminders(user_id,appointment_id);
alter table public.appointments enable row level security;
alter table public.appointment_reminders enable row level security;
revoke all on public.appointments,public.appointment_reminders from public,anon,authenticated;
grant select on public.appointments,public.appointment_reminders to authenticated;
create policy appointments_owner_read on public.appointments for select to authenticated using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=auth.uid()));
create policy appointment_reminders_owner_read on public.appointment_reminders for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.appointments a where a.id=appointment_id));

create function public.guard_appointment_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.pets p join public.households h on h.id=p.household_id where p.id=new.pet_id and h.id=new.household_id and h.owner_id=new.created_by) then raise exception 'Invalid care ownership'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Invalid time zone'; end if;
 if tg_op='UPDATE' and (new.household_id,new.pet_id,new.created_by,new.source,new.external_system,new.external_connection_id,new.external_appointment_id,new.created_at)
   is distinct from (old.household_id,old.pet_id,old.created_by,old.source,old.external_system,old.external_connection_id,old.external_appointment_id,old.created_at) then raise exception 'Appointment identity cannot change'; end if;
 return new;
end $$;
create trigger appointment_identity before insert or update on public.appointments for each row execute function public.guard_appointment_identity();
create function public.guard_appointment_reminder() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.appointments a join public.households h on h.id=a.household_id where a.id=new.appointment_id and h.owner_id=new.user_id) then raise exception 'Invalid reminder ownership'; end if;
 if tg_op='UPDATE' and (new.appointment_id,new.user_id,new.channel,new.reminder_minutes) is distinct from (old.appointment_id,old.user_id,old.channel,old.reminder_minutes) then raise exception 'Reminder identity cannot change'; end if;
 return new;
end $$;
create trigger appointment_reminder_identity before insert or update on public.appointment_reminders for each row execute function public.guard_appointment_reminder();

create function public.save_manual_appointment(p_id uuid,p_pet uuid,p_data jsonb,p_reminders integer[] default '{}') returns uuid
language plpgsql security definer set search_path='' as $$
declare household uuid; target uuid; old_start timestamptz; new_start timestamptz;
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('title','appointment_type','starts_at','ends_at','time_zone','status','provider_name','location_text','notes','google_place_id')) then raise exception 'Invalid appointment fields'; end if;
 if p_reminders is null or cardinality(p_reminders)>3 or exists(select 1 from unnest(p_reminders) r where r is null or r not in (120,1440,10080)) or cardinality(p_reminders)<>(select count(distinct r) from unnest(p_reminders) r) then raise exception 'Invalid reminders'; end if;
 select p.household_id into household from public.pets p join public.households h on h.id=p.household_id where p.id=p_pet and h.owner_id=auth.uid();
 if household is null then raise exception 'Not authorized'; end if;
 new_start:=(p_data->>'starts_at')::timestamptz;
 if p_id is null then
   perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,5));
   if (select count(*) from public.appointments where created_by=auth.uid() and created_at>now()-interval '1 day')>=100 then raise exception 'Daily appointment limit reached'; end if;
   insert into public.appointments(household_id,pet_id,created_by,source,title,appointment_type,starts_at,ends_at,time_zone,status,provider_name,location_text,notes,google_place_id)
   values(household,p_pet,auth.uid(),'manual',btrim(p_data->>'title'),p_data->>'appointment_type',new_start,nullif(p_data->>'ends_at','')::timestamptz,p_data->>'time_zone',coalesce(p_data->>'status','scheduled'),nullif(btrim(p_data->>'provider_name'),''),nullif(btrim(p_data->>'location_text'),''),nullif(btrim(p_data->>'notes'),''),nullif(p_data->>'google_place_id','')) returning id into target;
 else
   select id,starts_at into target,old_start from public.appointments where id=p_id and household_id=household and pet_id=p_pet and created_by=auth.uid() and source='manual' for update;
   if target is null then raise exception 'Not authorized'; end if;
   update public.appointments set title=btrim(p_data->>'title'),appointment_type=p_data->>'appointment_type',starts_at=new_start,ends_at=nullif(p_data->>'ends_at','')::timestamptz,time_zone=p_data->>'time_zone',status=p_data->>'status',provider_name=nullif(btrim(p_data->>'provider_name'),''),location_text=nullif(btrim(p_data->>'location_text'),''),notes=nullif(btrim(p_data->>'notes'),''),google_place_id=nullif(p_data->>'google_place_id',''),updated_at=now() where id=target;
 end if;
 delete from public.appointment_reminders where appointment_id=target and channel='in_app' and not(reminder_minutes=any(p_reminders));
 insert into public.appointment_reminders(appointment_id,user_id,reminder_minutes,channel) select target,auth.uid(),r,'in_app' from unnest(p_reminders) r on conflict(appointment_id,channel,reminder_minutes) do nothing;
 if old_start is distinct from new_start then update public.appointment_reminders set dismissed_at=null,sent_at=null where appointment_id=target and channel='in_app'; end if;
 return target;
end $$;
create function public.cancel_manual_appointment(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 update public.appointments a set status='cancelled',updated_at=now() where id=p_id and source='manual' and created_by=auth.uid() and exists(select 1 from public.households h where h.id=a.household_id and h.owner_id=auth.uid());
 if not found then raise exception 'Not authorized'; end if;
end $$;
create function public.dismiss_appointment_reminder(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 update public.appointment_reminders r set dismissed_at=now() where id=p_id and channel='in_app' and user_id=auth.uid() and exists(select 1 from public.appointments a join public.households h on h.id=a.household_id where a.id=r.appointment_id and h.owner_id=auth.uid());
 if not found then raise exception 'Not authorized'; end if;
end $$;
revoke all on function public.guard_appointment_identity(),public.guard_appointment_reminder(),public.save_manual_appointment(uuid,uuid,jsonb,integer[]),public.cancel_manual_appointment(uuid),public.dismiss_appointment_reminder(uuid) from public,anon,authenticated;
grant execute on function public.save_manual_appointment(uuid,uuid,jsonb,integer[]),public.cancel_manual_appointment(uuid),public.dismiss_appointment_reminder(uuid) to authenticated;
commit;
