begin;
-- Extend the existing message table. Logical immutable references survive removal of a
-- reminder through the existing appointment editor or a source verification record.
alter table public.notifications add column appointment_reminder_id uuid;
alter table public.notifications add column verification_request_id uuid;
alter table public.notifications add column subject_pet_id uuid;
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check(type in ('availability_match','care_due','appointment_reminder','verification_update'));
alter table public.notifications drop constraint notifications_action_url_check;
alter table public.notifications add constraint notifications_action_url_check check(
 (type='availability_match' and action_url ~ '^/openings/[a-f0-9-]{36}$') or
 (type='care_due' and action_url ~ '^/care/plans/[a-f0-9-]{36}$') or
 (type='appointment_reminder' and action_url ~ '^/appointments/[a-f0-9-]{36}$') or
 (type='verification_update' and action_url ~ '^/pets/[a-f0-9-]{36}/records$'));
alter table public.notifications drop constraint care_notification_reference;
alter table public.notifications add constraint care_notification_reference check(
 (type<>'care_due' and care_occurrence_id is null and care_reminder_minutes is null) or
 (type='care_due' and channel='in_app' and action_url is not null and care_occurrence_id is not null and care_reminder_minutes is not null and care_reminder_minutes in (0,120,1440,4320,10080)));
alter table public.notifications add constraint owner_notification_references check(
 (type in ('care_due','availability_match') and appointment_reminder_id is null and verification_request_id is null and subject_pet_id is null) or
 (type='appointment_reminder' and channel='in_app' and action_url is not null and appointment_reminder_id is not null and verification_request_id is null and subject_pet_id is not null) or
 (type='verification_update' and channel='in_app' and action_url is not null and verification_request_id is not null and appointment_reminder_id is null and subject_pet_id is not null));
create index owner_notification_page on public.notifications(user_id,created_at desc,id desc) where channel='in_app' and dismissed_at is null;
create index owner_notification_unread on public.notifications(user_id) where channel='in_app' and dismissed_at is null and read_at is null;
create index notification_appointment_reference on public.notifications(appointment_reminder_id) where appointment_reminder_id is not null;
create index notification_verification_reference on public.notifications(verification_request_id) where verification_request_id is not null;
create index appointment_unsent_reminders on public.appointment_reminders(appointment_id) where channel='in_app' and sent_at is null and dismissed_at is null;
create function public.guard_owner_notification_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
 if (new.appointment_reminder_id,new.verification_request_id,new.subject_pet_id) is distinct from (old.appointment_reminder_id,old.verification_request_id,old.subject_pet_id) then raise exception 'Notification reference immutable'; end if;
 else
 if new.type='appointment_reminder' and not exists(select 1 from public.appointment_reminders r join public.appointments a on a.id=r.appointment_id join public.households h on h.id=a.household_id where r.id=new.appointment_reminder_id and r.user_id=new.user_id and h.owner_id=new.user_id and a.pet_id=new.subject_pet_id and r.channel='in_app' and new.action_url='/appointments/'||a.id::text and new.dedupe_key='appointment-reminder:'||r.id::text) then raise exception 'Invalid appointment notification'; end if;
 if new.type='verification_update' and not exists(select 1 from public.verification_requests r join public.vaccinations v on v.id=r.vaccination_id join public.pets p on p.id=v.pet_id join public.households h on h.id=p.household_id where r.id=new.verification_request_id and r.status='verified' and h.owner_id=new.user_id and p.id=new.subject_pet_id and new.action_url='/pets/'||p.id::text||'/records' and new.dedupe_key='verification:'||r.id::text||':verified') then raise exception 'Invalid verification notification'; end if;
 end if;return new;
end $$;
create trigger owner_notification_reference before insert or update on public.notifications for each row execute function public.guard_owner_notification_reference();
-- A verified transition is emitted transactionally with existing provider verification.
-- No historical backfill: an upgrade must not generate a burst of old notifications.
create function public.notify_vaccination_verified() returns trigger language plpgsql security definer set search_path='' as $$
declare v public.vaccinations;recipient uuid;pet_name text;
begin
 if new.status='verified' and (tg_op='INSERT' or old.status is distinct from 'verified') then
 select * into v from public.vaccinations where id=new.vaccination_id;
 select h.owner_id,p.name into recipient,pet_name from public.pets p join public.households h on h.id=p.household_id where p.id=v.pet_id;
 insert into public.notifications(user_id,type,title,body,action_url,dedupe_key,verification_request_id,subject_pet_id)
 values(recipient,'verification_update','Vaccination verified',left(pet_name||'’s '||v.name||' vaccination was verified.',500),'/pets/'||v.pet_id::text||'/records','verification:'||new.id::text||':verified',new.id,v.pet_id) on conflict(user_id,dedupe_key) do nothing;
 elsif tg_op='UPDATE' and old.status='verified' and new.status<>'verified' then
 update public.notifications set dismissed_at=coalesce(dismissed_at,now()) where verification_request_id=new.id;
 end if;return new;
end $$;
create trigger vaccination_verified_notification after insert or update of status on public.verification_requests for each row execute function public.notify_vaccination_verified();
create function public.retire_source_notifications() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='appointment_reminders' then
 if tg_op='DELETE' or new.dismissed_at is not null then update public.notifications set dismissed_at=coalesce(dismissed_at,now()) where appointment_reminder_id=old.id; end if;
 elsif tg_table_name='verification_requests' then update public.notifications set dismissed_at=coalesce(dismissed_at,now()) where verification_request_id=old.id;
 else
 if new.status in ('cancelled','completed') or (new.starts_at,new.title,new.time_zone) is distinct from (old.starts_at,old.title,old.time_zone) then
 update public.notifications set dismissed_at=coalesce(dismissed_at,now()) where appointment_reminder_id in(select id from public.appointment_reminders where appointment_id=new.id);
 end if;
 end if;return case when tg_op='DELETE' then old else new end;
end $$;
create trigger retire_appointment_notice after update of starts_at,status,title,time_zone on public.appointments for each row execute function public.retire_source_notifications();
create trigger retire_removed_reminder before delete or update of dismissed_at on public.appointment_reminders for each row execute function public.retire_source_notifications();
create trigger retire_removed_verification before delete on public.verification_requests for each row execute function public.retire_source_notifications();
do $$ begin if not exists(select 1 from pg_roles where rolname='pawport_appointment_worker') then create role pawport_appointment_worker nologin noinherit; end if;end $$;
grant usage on schema public to pawport_appointment_worker;
create function public.process_appointment_reminders(p_now timestamptz default now(),p_limit integer default 200) returns integer language plpgsql security definer set search_path='' as $$
declare a public.appointments;r public.appointment_reminders;pet_name text;made integer:=0;n integer;
begin
 if p_now is null or not isfinite(p_now) or p_limit is null or p_limit<1 or p_limit>500 then raise exception 'Invalid worker bounds'; end if;
 for a in select ap.* from public.appointments ap where ap.status in ('scheduled','confirmed','requested','waitlisted') and ap.starts_at>=p_now and exists(select 1 from public.appointment_reminders rr where rr.appointment_id=ap.id and rr.channel='in_app' and rr.dismissed_at is null and rr.sent_at is null and ap.starts_at-make_interval(mins=>rr.reminder_minutes)<=p_now) order by ap.starts_at,ap.id limit p_limit for update skip locked loop
 select name into pet_name from public.pets where id=a.pet_id;
 for r in select * from public.appointment_reminders where appointment_id=a.id and channel='in_app' and sent_at is null and dismissed_at is null and a.starts_at-make_interval(mins=>reminder_minutes)<=p_now order by reminder_minutes for update loop
 insert into public.notifications(user_id,type,title,body,action_url,dedupe_key,appointment_reminder_id,subject_pet_id,dismissed_at)
 values(a.created_by,'appointment_reminder','Upcoming appointment',left(pet_name||'’s '||a.title||' is scheduled for '||to_char(a.starts_at at time zone a.time_zone,'Mon DD, YYYY HH24:MI')||' ('||a.time_zone||').',500),'/appointments/'||a.id::text,'appointment-reminder:'||r.id::text,r.id,a.pet_id,
 case when r.reminder_minutes>(select min(reminder_minutes) from public.appointment_reminders where appointment_id=a.id and channel='in_app' and dismissed_at is null and a.starts_at-make_interval(mins=>reminder_minutes)<=p_now) then p_now end) on conflict(user_id,dedupe_key) do nothing;
 get diagnostics n=row_count;made:=made+n;
 update public.appointment_reminders set sent_at=coalesce(sent_at,p_now) where id=r.id;
 update public.notifications set dismissed_at=coalesce(dismissed_at,p_now) where appointment_reminder_id in(select id from public.appointment_reminders where appointment_id=a.id and reminder_minutes>r.reminder_minutes);
 end loop;end loop;return made;
end $$;
-- Shared visibility predicate keeps demo availability out of production surfaces.
create function public.owner_notification_visible(p_id uuid,p_demo boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notifications n where n.id=p_id and n.user_id=auth.uid() and n.channel='in_app' and n.dismissed_at is null and (n.type<>'availability_match' or exists(select 1 from public.availability_matches m join public.availability_watches w on w.id=m.watch_id join public.provider_connections c on c.id=w.connection_id where m.notification_id=n.id and (c.external_system<>'mock' or p_demo))));
$$;
create function public.my_notifications(p_unread boolean default false,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25,p_demo boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if p_limit is null or p_limit<1 or p_limit>50 or (p_before is null)<>(p_before_id is null) or (p_before is not null and not isfinite(p_before)) then raise exception 'Invalid notification page'; end if;
 with selected as (select n.*,coalesce(n.subject_pet_id,cp.pet_id,w.pet_id) pet from public.notifications n left join public.care_plan_occurrences co on co.id=n.care_occurrence_id left join public.care_plans cp on cp.id=co.plan_id left join public.availability_matches m on m.notification_id=n.id left join public.availability_watches w on w.id=m.watch_id
 where n.user_id=auth.uid() and public.owner_notification_visible(n.id,p_demo) and (not p_unread or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id)) order by n.created_at desc,n.id desc limit p_limit+1), numbered as(select s.*,row_number() over(order by created_at desc,id desc) seq from selected s)
 select jsonb_build_object('notifications',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'type',n.type,'title',n.title,'body',n.body,'actionUrl',n.action_url,'createdAt',n.created_at,'readAt',n.read_at,'dismissedAt',n.dismissed_at,'petId',p.id,'petName',p.name) order by n.seq) from numbered n left join public.pets p on p.id=n.pet and public.owns_health_pet(p.id) where n.seq<=p_limit),'[]'::jsonb),'nextCursor',case when exists(select 1 from numbered where seq>p_limit) then(select jsonb_build_object('at',created_at,'id',id) from numbered where seq=p_limit) end) into result;return result;
end $$;
create function public.my_notification_count(p_demo boolean default false) returns integer language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Not authorized'; end if;return(select count(*)::integer from public.notifications n where n.user_id=auth.uid() and n.read_at is null and public.owner_notification_visible(n.id,p_demo));end $$;
create function public.mark_all_notifications_read() returns void language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Not authorized'; end if;update public.notifications set read_at=now() where user_id=auth.uid() and channel='in_app' and read_at is null and dismissed_at is null;end $$;
-- Normalized current state; no today_items table and no copies of source records.
create function public.my_pawport_today(p_zone text default 'UTC') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;today date;
begin
 if auth.uid() is null or not exists(select 1 from public.households where owner_id=auth.uid()) then raise exception 'Not authorized'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_zone) then raise exception 'Invalid time zone'; end if;
 today:=(now() at time zone p_zone)::date;
 with owned as(select p.id,p.name from public.pets p join public.households h on h.id=p.household_id where h.owner_id=auth.uid()),care as(
 select cp.*,o.id occurrence_id,coalesce(o.snoozed_until,o.scheduled_for) due,o.snoozed_until,op.name pet_name,(cp.anchor_local_time is null and o.snoozed_until is null) date_only from public.care_plans cp join owned op on op.id=cp.pet_id join public.care_plan_occurrences o on o.plan_id=cp.id and o.status='pending' where cp.status='active'),
 raw as (
 select 'care:'||c.occurrence_id::text id,c.pet_id,c.pet_name,'care_due' kind,'care' category,c.title,'Owner-entered care routine' subtitle,c.due due_at,c.date_only, '/care/plans/'||c.id::text action_url,'care' source_type,null::text trust_state,
 case when c.date_only then case when (c.due at time zone c.time_zone)::date<(now() at time zone c.time_zone)::date then 'overdue' when (c.due at time zone c.time_zone)::date=(now() at time zone c.time_zone)::date then 'today' else 'soon' end
 when c.due<now() then 'overdue' when (c.due at time zone p_zone)::date=today then 'today' else 'soon' end urgency,
 jsonb_build_object('occurrenceId',c.occurrence_id,'timeZone',c.time_zone,'snoozed',c.snoozed_until is not null) metadata
 from care c where (c.due at time zone case when c.date_only then c.time_zone else p_zone end)::date<=case when c.date_only then (now() at time zone c.time_zone)::date else today end+7
 union all
 select 'appointment:'||a.id::text,a.pet_id,p.name,'appointment','appointment',a.title,case when a.source='external' then 'Synced from provider' else 'Owner-entered appointment' end,a.starts_at,false,'/appointments/'||a.id::text,'appointment',null,case when (a.starts_at at time zone p_zone)::date=today then 'today' else 'soon' end,jsonb_build_object('timeZone',a.time_zone,'providerName',a.provider_name)
 from public.appointments a join owned p on p.id=a.pet_id where a.status in ('scheduled','confirmed','requested','waitlisted') and coalesce(a.ends_at,a.starts_at+interval '1 hour')>=now() and (a.starts_at at time zone p_zone)::date between today and today+7
 union all
 select 'vaccination-expiration:'||v.id::text,v.pet_id,p.name,'record_expiration','health',v.name||' vaccination record '||case when v.due_on<today then 'expired ' else 'expires ' end||to_char(v.due_on,'Mon DD, YYYY'),null,v.due_on::timestamp at time zone p_zone,true,'/pets/'||p.id::text||'/records','vaccination',case t->>'verification_status' when 'provider_verified' then 'vet_verified' when 'document_supported' then 'document_supported' else 'owner_entered' end,case when v.due_on<today then 'overdue' when v.due_on=today then 'today' else 'info' end,jsonb_build_object('timeZone',p_zone,'recordDate',v.due_on)
 from owned p cross join lateral jsonb_array_elements(public.owner_vaccination_trust(p.id)) t join public.vaccinations v on v.id=(t->>'vaccination_id')::uuid where v.due_on is not null and v.due_on<=today+30
 union all
 select 'verification:'||n.verification_request_id::text,n.subject_pet_id,p.name,'verification_result','notification',n.title,n.body,null,false,n.action_url,'verification','vet_verified','info',jsonb_build_object('notificationId',n.id)
 from public.notifications n join owned p on p.id=n.subject_pet_id join public.verification_requests vr on vr.id=n.verification_request_id and vr.status='verified' where n.user_id=auth.uid() and n.type='verification_update' and n.read_at is null and n.dismissed_at is null
 ), ranked as(select r.*,case when category='care' and urgency='overdue' then 1 when category='care' and urgency='today' then 2 when category='appointment' then 4 when category='notification' then 5 else 6 end priority,case when category in ('care','appointment') and urgency='soon' then 'comingUp' else 'attention' end section from raw r), dto as(select *,jsonb_build_object('id',id,'petId',pet_id,'petName',pet_name,'kind',kind,'category',category,'urgency',urgency,'title',title,'subtitle',subtitle,'dueAt',due_at,'dateOnly',date_only,'actionUrl',action_url,'sourceType',source_type,'trustState',trust_state,'metadata',metadata) item from ranked),
 recent as(select e,op.name pet_name from owned op cross join lateral jsonb_array_elements(public.my_pet_timeline(op.id,'all',null,null,5)->'events') e order by (e->>'occurredAt')::timestamptz desc,e->>'id' collate "C" desc limit 5)
 select jsonb_build_object('attention',coalesce((select jsonb_agg(item order by priority,due_at nulls last,id) from (select * from dto where section='attention' order by priority,due_at nulls last,id limit 10) x),'[]'::jsonb),'comingUp',coalesce((select jsonb_agg(item order by due_at,id) from(select * from dto where section='comingUp' order by due_at,id limit 10)x),'[]'::jsonb),'recentActivity',coalesce((select jsonb_agg(e||jsonb_build_object('petName',pet_name) order by (e->>'occurredAt')::timestamptz desc,e->>'id' collate "C" desc) from recent),'[]'::jsonb),'summary',jsonb_build_object('overdueCount',(select count(*) from raw where category='care' and urgency='overdue'),'dueTodayCount',(select count(*) from raw where category in ('care','appointment') and urgency='today'),'nextSevenDaysCount',(select count(*) from raw where category in ('care','appointment') and urgency in ('today','soon')),'careThisWeek',(select count(*) from raw where category='care' and urgency in ('today','soon')),'appointmentsThisWeek',(select count(*) from raw where category='appointment'),'activeOpeningMatches',0),'hasTrackedData',exists(select 1 from public.care_plans cp join owned o on o.id=cp.pet_id) or exists(select 1 from public.appointments a join owned o on o.id=a.pet_id) or exists(select 1 from public.vaccinations v join owned o on o.id=v.pet_id) or exists(select 1 from recent)) into result;return result;
end $$;
create function public.my_today_openings(p_systems text[] default '{}') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if p_systems is null or cardinality(p_systems)>5 or not p_systems <@ array['mock','ezyvet','daysmart','gingr','moego']::text[] then raise exception 'Invalid capabilities'; end if;
 with eligible as(select m.*,w.pet_id,p.name pet_name,c.display_name,c.external_system from public.availability_matches m join public.availability_watches w on w.id=m.watch_id join public.pets p on p.id=w.pet_id join public.provider_connections c on c.id=w.connection_id where w.created_by=auth.uid() and c.external_system=any(p_systems) and public.availability_watch_state(w.id) in ('active','matched') and m.status in ('available','notified') and m.starts_at>now() and m.last_seen_at>=now()-interval '24 hours')
 select jsonb_build_object('count',(select count(*) from eligible),'items',coalesce((select jsonb_agg(jsonb_build_object('id','opening:'||id::text,'petId',pet_id,'petName',pet_name,'kind','opening','category','opening','urgency','today','title','Earlier opening found','subtitle',display_name||' · Availability can change quickly.','dueAt',starts_at,'dateOnly',false,'actionUrl','/openings/'||watch_id::text,'sourceType','opening','trustState',null,'metadata',jsonb_build_object('demo',external_system='mock','checkedAt',last_seen_at)) order by starts_at,id) from(select * from eligible order by starts_at,id limit 10)x),'[]'::jsonb)) into result;return result;
end $$;
do $$ declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('guard_owner_notification_reference','notify_vaccination_verified','retire_source_notifications','process_appointment_reminders','owner_notification_visible','my_notifications','my_notification_count','mark_all_notifications_read','my_pawport_today','my_today_openings') loop execute format('revoke all on function %s from public,anon,authenticated,pawport_care_worker,pawport_scheduling_worker,pawport_appointment_worker',f.signature);end loop;end $$;
grant execute on function public.my_notifications(boolean,timestamptz,uuid,integer,boolean),public.my_notification_count(boolean),public.mark_all_notifications_read(),public.my_pawport_today(text),public.my_today_openings(text[]) to authenticated;
grant execute on function public.process_appointment_reminders(timestamptz,integer) to pawport_appointment_worker;
commit;
