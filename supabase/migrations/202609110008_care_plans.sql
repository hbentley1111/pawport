begin;
create table public.care_plans (
 id uuid primary key default gen_random_uuid(), household_id uuid not null references public.households(id),
 pet_id uuid not null references public.pets(id), created_by uuid not null references auth.users(id),
 title text not null check(length(btrim(title)) between 1 and 120),
 category text not null check(category in ('medication','heartworm','flea_tick','grooming','nail_trim','dental','wellness','vaccination','supplement','exercise','custom')),
 instructions text check(length(instructions)<=1000), recurrence_type text not null check(recurrence_type in ('one_time','interval')),
 interval_value integer, interval_unit text check(interval_unit in ('day','week','month')),
 time_zone text not null check(length(time_zone) between 1 and 100), anchor_local_date date not null check(anchor_local_date between date '1900-01-01' and date '2199-12-31'),
 anchor_local_time time check(anchor_local_time<time '24:00'), ends_on date check(ends_on>=anchor_local_date and ends_on<=date '2199-12-31'),
 status text not null default 'active' check(status in ('active','paused','archived')),
 source text not null default 'owner_entered' check(source='owner_entered'), revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((recurrence_type='one_time' and interval_value is null and interval_unit is null) or (recurrence_type='interval' and interval_value is not null and interval_value between 1 and 365 and interval_unit is not null))
);
create table public.care_plan_occurrences (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references public.care_plans(id),
 revision integer not null, sequence integer not null check(sequence>=0),
 scheduled_for timestamptz not null check(isfinite(scheduled_for)), snoozed_until timestamptz check(isfinite(snoozed_until)),
 status text not null default 'pending' check(status in ('pending','completed','skipped','cancelled')),
 completed_at timestamptz, skipped_at timestamptz, completion_note text check(length(completion_note)<=500),
 title_snapshot text not null, category_snapshot text not null, time_zone_snapshot text not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(plan_id,revision,sequence),
 check((status='completed')=(completed_at is not null)),check((status='skipped')=(skipped_at is not null))
);
create unique index care_one_pending on public.care_plan_occurrences(plan_id) where status='pending';
create index care_plan_owner on public.care_plans(household_id,pet_id,status);
create index care_history on public.care_plan_occurrences(plan_id,created_at desc);
create table public.care_plan_reminders (
 id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.care_plans(id),
 reminder_minutes integer not null check(reminder_minutes in (0,120,1440,4320,10080)),
 channel text not null default 'in_app' check(channel='in_app'),created_at timestamptz not null default now(),
 unique(plan_id,channel,reminder_minutes)
);
do $$ begin
 if not exists(select 1 from pg_roles where rolname='pawport_care_worker') then create role pawport_care_worker nologin noinherit; end if;
end $$;
grant usage on schema public to pawport_care_worker;
do $$ declare t text; begin foreach t in array array['care_plans','care_plan_occurrences','care_plan_reminders'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,pawport_scheduling_worker,pawport_care_worker',t);
end loop; end $$;
-- Only these two Phase 5C checks change; its notification RPCs and identity guard remain intact.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in ('availability_match','care_due'));
alter table public.notifications drop constraint notifications_action_url_check;
alter table public.notifications add constraint notifications_action_url_check check(
 (type='availability_match' and action_url ~ '^/openings/[a-f0-9-]{36}$') or
 (type='care_due' and action_url ~ '^/care/plans/[a-f0-9-]{36}$'));
alter table public.notifications add column care_occurrence_id uuid references public.care_plan_occurrences(id);
alter table public.notifications add column care_reminder_minutes integer;
alter table public.notifications add constraint care_notification_reference check(
 (type='availability_match' and care_occurrence_id is null and care_reminder_minutes is null) or
 (type='care_due' and channel='in_app' and action_url is not null and care_occurrence_id is not null and care_reminder_minutes is not null and care_reminder_minutes in (0,120,1440,4320,10080)));
create index care_notification_occurrence on public.notifications(care_occurrence_id) where care_occurrence_id is not null;
create function public.guard_care_plan() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.pets p join public.households h on h.id=p.household_id where p.id=new.pet_id and h.id=new.household_id and h.owner_id=new.created_by) then raise exception 'Invalid care ownership'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.time_zone) then raise exception 'Choose a valid time zone'; end if;
 if tg_op='UPDATE' then
 if (new.id,new.household_id,new.pet_id,new.created_by,new.source,new.created_at) is distinct from (old.id,old.household_id,old.pet_id,old.created_by,old.source,old.created_at) then raise exception 'Care identity immutable'; end if;
 if old.status='archived' and new.status<>'archived' then raise exception 'Archived routines cannot restart'; end if;
 end if;return new;
end $$;
create trigger care_plan_guard before insert or update on public.care_plans for each row execute function public.guard_care_plan();
create function public.guard_care_occurrence() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.plan_id,new.revision,new.sequence,new.scheduled_for,new.created_at) is distinct from (old.id,old.plan_id,old.revision,old.sequence,old.scheduled_for,old.created_at) then raise exception 'Occurrence identity immutable'; end if;
 if old.status<>'pending' then raise exception 'Care history immutable'; end if;return new;
end $$;
create trigger care_occurrence_guard before update on public.care_plan_occurrences for each row execute function public.guard_care_occurrence();
create function public.guard_care_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.care_occurrence_id,new.care_reminder_minutes) is distinct from (old.care_occurrence_id,old.care_reminder_minutes) then raise exception 'Care notification identity immutable'; end if;
 if new.type='care_due' and not exists(select 1 from public.care_plan_occurrences o join public.care_plans p on p.id=o.plan_id join public.households h on h.id=p.household_id where o.id=new.care_occurrence_id and h.owner_id=new.user_id and new.action_url='/care/plans/'||p.id::text and new.dedupe_key='care:'||o.id::text||':'||new.care_reminder_minutes::text) then raise exception 'Invalid care notification recipient'; end if;
 return new;
end $$;
create trigger care_notification_guard before insert or update on public.notifications for each row execute function public.guard_care_notification();
-- The only recurrence calendar calculation. Index always refers to the original anchor.
create function public.care_scheduled_at(p_plan public.care_plans,p_sequence integer) returns timestamptz language plpgsql stable set search_path='' as $$
declare d date; m date; n integer;
begin
 if p_sequence<0 or p_sequence>200000 then raise exception 'Invalid recurrence index'; end if;
 if p_plan.recurrence_type='one_time' then if p_sequence>0 then return null; end if; d:=p_plan.anchor_local_date;
 elsif p_plan.interval_unit='month' then
 n:=p_sequence*p_plan.interval_value;
 if n>120000 then return null; end if;
 m:=(date_trunc('month',p_plan.anchor_local_date::timestamp)+make_interval(months=>n))::date;
 d:=m+least(extract(day from p_plan.anchor_local_date)::integer,extract(day from (m+interval '1 month - 1 day'))::integer)-1;
 else d:=p_plan.anchor_local_date+(p_sequence*p_plan.interval_value*case when p_plan.interval_unit='week' then 7 else 1 end);
 end if;
 if d>date '2199-12-31' or (p_plan.ends_on is not null and d>p_plan.ends_on) then return null; end if;
 return (d+coalesce(p_plan.anchor_local_time,time '09:00')) at time zone p_plan.time_zone;
end $$;
create function public.generate_care_occurrence(p_id uuid,p_sequence integer) returns void language plpgsql security definer set search_path='' as $$
declare p public.care_plans; due timestamptz;
begin
 select * into p from public.care_plans where id=p_id for update;
 if p.status<>'active' or exists(select 1 from public.care_plan_occurrences where plan_id=p_id and status='pending') then return; end if;
 due:=public.care_scheduled_at(p,p_sequence);if due is null then return; end if;
 insert into public.care_plan_occurrences(plan_id,revision,sequence,scheduled_for,title_snapshot,category_snapshot,time_zone_snapshot) values(p.id,p.revision,p_sequence,due,p.title,p.category,p.time_zone) on conflict do nothing;
end $$;
create function public.dismiss_care_notifications(p_plan uuid) returns void language sql security definer set search_path='' as $$
 update public.notifications n set dismissed_at=coalesce(n.dismissed_at,now()) from public.care_plan_occurrences o where o.plan_id=p_plan and o.id=n.care_occurrence_id and n.dismissed_at is null;
$$;
create function public.save_care_plan(p_id uuid,p_pet uuid,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare h uuid;p public.care_plans; target uuid; changed boolean; offsets integer[];
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('title','category','instructions','recurrence_type','interval_value','interval_unit','time_zone','anchor_local_date','anchor_local_time','ends_on','reminders')) then raise exception 'Invalid care fields'; end if;
 select pets.household_id into h from public.pets join public.households hh on hh.id=pets.household_id where pets.id=p_pet and hh.owner_id=auth.uid();
 if h is null then raise exception 'Not authorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,8));
 if jsonb_typeof(p_data->'reminders') is distinct from 'array' or jsonb_array_length(p_data->'reminders')>5 then raise exception 'Choose up to five reminders'; end if;
 select coalesce(array_agg(x::integer),array[]::integer[]) into offsets from jsonb_array_elements_text(p_data->'reminders') x;
 if array_position(offsets,null) is not null or not offsets <@ array[0,120,1440,4320,10080] then raise exception 'Invalid reminder'; end if;
 if p_id is null then
 if (select count(*) from public.care_plans where pet_id=p_pet and status='active')>=50 or (select count(*) from public.care_plans where created_by=auth.uid() and created_at>=now()-interval '1 day')>=50 then raise exception 'Care routine limit reached'; end if;
 insert into public.care_plans(household_id,pet_id,created_by,title,category,instructions,recurrence_type,interval_value,interval_unit,time_zone,anchor_local_date,anchor_local_time,ends_on)
 values(h,p_pet,auth.uid(),btrim(p_data->>'title'),p_data->>'category',nullif(p_data->>'instructions',''),p_data->>'recurrence_type',(p_data->>'interval_value')::integer,p_data->>'interval_unit',p_data->>'time_zone',(p_data->>'anchor_local_date')::date,nullif(p_data->>'anchor_local_time','')::time,nullif(p_data->>'ends_on','')::date) returning id into target;
 perform public.generate_care_occurrence(target,0);
 else
 select * into p from public.care_plans where id=p_id and household_id=h and pet_id=p_pet and created_by=auth.uid() for update;
 if p.id is null or p.status='archived' then raise exception 'Routine unavailable'; end if;
 changed:=(p.recurrence_type,p.interval_value,p.interval_unit,p.time_zone,p.anchor_local_date,p.anchor_local_time,p.ends_on) is distinct from (p_data->>'recurrence_type',(p_data->>'interval_value')::integer,p_data->>'interval_unit',p_data->>'time_zone',(p_data->>'anchor_local_date')::date,nullif(p_data->>'anchor_local_time','')::time,nullif(p_data->>'ends_on','')::date);
 update public.care_plans set title=btrim(p_data->>'title'),category=p_data->>'category',instructions=nullif(p_data->>'instructions',''),recurrence_type=p_data->>'recurrence_type',interval_value=(p_data->>'interval_value')::integer,interval_unit=p_data->>'interval_unit',time_zone=p_data->>'time_zone',anchor_local_date=(p_data->>'anchor_local_date')::date,anchor_local_time=nullif(p_data->>'anchor_local_time','')::time,ends_on=nullif(p_data->>'ends_on','')::date,revision=revision+case when changed then 1 else 0 end,updated_at=now() where id=p_id;
 if changed then
 update public.care_plan_occurrences set status='cancelled',updated_at=now() where plan_id=p_id and status='pending';
 perform public.generate_care_occurrence(p_id,0);
 else update public.care_plan_occurrences set title_snapshot=p_data->>'title',category_snapshot=p_data->>'category',updated_at=now() where plan_id=p_id and status='pending'; end if;
 perform public.dismiss_care_notifications(p_id);target:=p_id;
 end if;
 delete from public.care_plan_reminders where plan_id=target;
 insert into public.care_plan_reminders(plan_id,reminder_minutes) select target,x from unnest(offsets) x on conflict do nothing;
 return target;
end $$;
create function public.resolve_care_occurrence(p_id uuid,p_status text,p_note text default null) returns void language plpgsql security definer set search_path='' as $$
declare p public.care_plans;o public.care_plan_occurrences;
begin
 select cp.* into p from public.care_plans cp join public.care_plan_occurrences co on co.plan_id=cp.id where co.id=p_id and cp.created_by=auth.uid() for update of cp;
 if p.id is null or p_status is null or p_status not in ('completed','skipped') or length(p_note)>500 then raise exception 'Invalid care action'; end if;
 select * into o from public.care_plan_occurrences where id=p_id for update;
 if o.status<>'pending' then return; end if;
 if p.status<>'active' then raise exception 'Resume the routine before recording care'; end if;
 update public.care_plan_occurrences set status=p_status,completed_at=case when p_status='completed' then now() end,skipped_at=case when p_status='skipped' then now() end,completion_note=nullif(p_note,''),updated_at=now() where id=p_id;
 perform public.dismiss_care_notifications(p.id);
 perform public.generate_care_occurrence(p.id,o.sequence+1);
end $$;
create function public.complete_care_occurrence(p_id uuid,p_note text default null) returns void language sql security definer set search_path='' as $$ select public.resolve_care_occurrence(p_id,'completed',p_note); $$;
create function public.skip_care_occurrence(p_id uuid,p_note text default null) returns void language sql security definer set search_path='' as $$ select public.resolve_care_occurrence(p_id,'skipped',p_note); $$;
create function public.snooze_care_occurrence(p_id uuid,p_until timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare p public.care_plans;o public.care_plan_occurrences;
begin
 select cp.* into p from public.care_plans cp join public.care_plan_occurrences co on co.plan_id=cp.id where co.id=p_id and cp.created_by=auth.uid() for update of cp;
 if p.id is null or p.status<>'active' then raise exception 'Routine unavailable'; end if;
 select * into o from public.care_plan_occurrences where id=p_id for update;
 if o.status<>'pending' or p_until is null or not isfinite(p_until) or p_until<=greatest(now(),o.scheduled_for) or p_until>greatest(o.scheduled_for,now())+interval '30 days' or p_until>o.created_at+interval '400 days' then raise exception 'Choose a later time within 30 days'; end if;
 update public.care_plan_occurrences set snoozed_until=p_until,updated_at=now() where id=p_id;
 perform public.dismiss_care_notifications(p.id);
end $$;
create function public.set_care_plan_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
declare p public.care_plans;seq integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,8));
 select * into p from public.care_plans where id=p_id and created_by=auth.uid() for update;
 if p.id is null or p_status is null or p_status not in ('active','paused','archived') or (p.status='archived' and p_status<>'archived') then raise exception 'Routine unavailable'; end if;
 if p_status='active' and p.status<>'active' and (select count(*) from public.care_plans where pet_id=p.pet_id and status='active')>=50 then raise exception 'Care routine limit reached'; end if;
 update public.care_plans set status=p_status,updated_at=now() where id=p_id;
 if p_status='archived' then update public.care_plan_occurrences set status='cancelled',updated_at=now() where plan_id=p_id and status='pending'; end if;
 if p_status<>'active' then perform public.dismiss_care_notifications(p_id);
 else
 select coalesce(max(sequence)+1,0) into seq from public.care_plan_occurrences where plan_id=p_id and revision=p.revision;
 perform public.generate_care_occurrence(p_id,seq);
 end if;
end $$;
-- Explicit owner DTOs; no creator or household identifier returned.
create function public.my_care_plans(p_pet uuid default null,p_id uuid default null,p_offset integer default 0,p_limit integer default 1000) returns jsonb language sql stable security definer set search_path='' as $$
 with selected as (select cp.* from public.care_plans cp join public.households hh on hh.id=cp.household_id where hh.owner_id=auth.uid() and (p_pet is null or cp.pet_id=p_pet) and (p_id is null or cp.id=p_id) order by case cp.status when 'active' then 0 when 'paused' then 1 else 2 end,cp.created_at desc,cp.id limit least(greatest(coalesce(p_limit,1000),1),1000) offset least(greatest(coalesce(p_offset,0),0),100000))
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'pet_id',p.pet_id,'pet_name',pet.name,'title',p.title,'category',p.category,'instructions',p.instructions,'recurrence_type',p.recurrence_type,'interval_value',p.interval_value,'interval_unit',p.interval_unit,'time_zone',p.time_zone,'anchor_local_date',p.anchor_local_date,'anchor_local_time',p.anchor_local_time,'ends_on',p.ends_on,'status',p.status,'source',p.source,'updated_at',p.updated_at,'occurrence',case when o.id is null then null else jsonb_build_object('id',o.id,'scheduled_for',o.scheduled_for,'snoozed_until',o.snoozed_until,'status',o.status) end,'reminders',(select coalesce(jsonb_agg(r.reminder_minutes order by r.reminder_minutes),'[]'::jsonb) from public.care_plan_reminders r where r.plan_id=p.id)) order by coalesce(o.snoozed_until,o.scheduled_for),p.created_at),'[]'::jsonb)
 from selected p join public.pets pet on pet.id=p.pet_id join public.households h on h.id=p.household_id left join public.care_plan_occurrences o on o.plan_id=p.id and o.status='pending'
 where h.owner_id=auth.uid() and (p_pet is null or p.pet_id=p_pet);
$$;
create function public.care_plan_detail(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (select o.id,o.scheduled_for,o.snoozed_until,o.status,o.completed_at,o.skipped_at,o.completion_note,o.title_snapshot,o.category_snapshot,o.time_zone_snapshot,o.created_at from public.care_plan_occurrences o where o.plan_id=p.id and o.status<>'pending' order by o.created_at desc limit 100) x)) from public.care_plans p join public.households h on h.id=p.household_id where p.id=p_id and h.owner_id=auth.uid();
$$;
create function public.my_care_notifications() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (select id,title,body,action_url,created_at,read_at from public.notifications where user_id=auth.uid() and type='care_due' and channel='in_app' and dismissed_at is null order by created_at desc limit 50) x;
$$;
create function public.process_care_reminders(p_now timestamptz default now(),p_limit integer default 200) returns integer language plpgsql security definer set search_path='' as $$
declare p public.care_plans;o public.care_plan_occurrences;r record;due timestamptz;count_created integer:=0;delta integer;pet_name text;
begin
 if p_now is null or not isfinite(p_now) or p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid worker bounds'; end if;
 -- Only candidates with an undelivered due offset; processed plans cannot starve later batches.
 for p in select cp.* from public.care_plans cp where cp.status='active' and exists(select 1 from public.care_plan_occurrences co join public.care_plan_reminders cr on cr.plan_id=cp.id where co.plan_id=cp.id and co.status='pending' and coalesce(co.snoozed_until,co.scheduled_for)-make_interval(mins=>cr.reminder_minutes)<=p_now and not exists(select 1 from public.notifications n where n.care_occurrence_id=co.id and n.care_reminder_minutes=cr.reminder_minutes)) order by cp.id limit p_limit for update skip locked loop
 select * into o from public.care_plan_occurrences where plan_id=p.id and status='pending' for update;
 if o.id is null then continue; end if;
 due:=coalesce(o.snoozed_until,o.scheduled_for);
 select name into pet_name from public.pets where id=p.pet_id;
 for r in select reminder_minutes from public.care_plan_reminders where plan_id=p.id and due-make_interval(mins=>reminder_minutes)<=p_now loop
 insert into public.notifications(user_id,type,title,body,action_url,dedupe_key,care_occurrence_id,care_reminder_minutes,dismissed_at)
 values(p.created_by,'care_due','Care reminder',left(p.title||' for '||pet_name||' is scheduled for '||to_char(due at time zone p.time_zone,'Mon DD, YYYY HH24:MI')||' ('||p.time_zone||'). Owner-entered routine.',500),'/care/plans/'||p.id::text,'care:'||o.id::text||':'||r.reminder_minutes::text,o.id,r.reminder_minutes,case when r.reminder_minutes>(select min(cr.reminder_minutes) from public.care_plan_reminders cr where cr.plan_id=p.id and due-make_interval(mins=>cr.reminder_minutes)<=p_now) then p_now end) on conflict(user_id,dedupe_key) do nothing;
 get diagnostics delta=row_count;count_created:=count_created+delta;
 update public.notifications set dismissed_at=coalesce(dismissed_at,p_now) where care_occurrence_id=o.id and care_reminder_minutes>r.reminder_minutes and dismissed_at is null;
 end loop;
 end loop;return count_created;
end $$;
-- Default EXECUTE is revoked for every new helper, including trigger functions.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_care_plan','guard_care_occurrence','guard_care_notification','care_scheduled_at','generate_care_occurrence','dismiss_care_notifications','save_care_plan','resolve_care_occurrence','complete_care_occurrence','skip_care_occurrence','snooze_care_occurrence','set_care_plan_status','my_care_plans','care_plan_detail','my_care_notifications','process_care_reminders') loop
 execute format('revoke all on function %s from public,anon,authenticated,pawport_scheduling_worker,pawport_care_worker',f.signature);
 end loop;
end $$;
grant execute on function public.save_care_plan(uuid,uuid,jsonb),public.complete_care_occurrence(uuid,text),public.skip_care_occurrence(uuid,text),public.snooze_care_occurrence(uuid,timestamptz),public.set_care_plan_status(uuid,text),public.my_care_plans(uuid,uuid,integer,integer),public.care_plan_detail(uuid),public.my_care_notifications() to authenticated;
grant execute on function public.process_care_reminders(timestamptz,integer) to pawport_care_worker;
commit;
