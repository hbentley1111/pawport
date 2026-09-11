begin;
-- First-party community data only. No Google business content is mirrored.
create table public.service_reviews (
 id uuid primary key default gen_random_uuid(),
 google_place_id text not null check(length(google_place_id) between 1 and 255 and google_place_id ~ '^[A-Za-z0-9_-]+$'),
 user_id uuid not null references auth.users(id) on delete cascade,
 rating smallint not null check(rating between 1 and 5),
 comment text check(length(comment)<=1500),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 hidden_at timestamptz,
 moderation_note text check(length(moderation_note)<=1000),
 unique(user_id,google_place_id)
);
create index service_reviews_published_idx on public.service_reviews(google_place_id,created_at desc,id) where deleted_at is null and hidden_at is null;
create table public.service_favorites (
 user_id uuid not null references auth.users(id) on delete cascade,
 google_place_id text not null check(length(google_place_id) between 1 and 255 and google_place_id ~ '^[A-Za-z0-9_-]+$'),
 created_at timestamptz not null default now(),
 primary key(user_id,google_place_id)
);
create table public.user_service_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 postal_code text not null check(postal_code ~ '^[0-9]{5}$'),
 radius_miles smallint not null default 10 check(radius_miles in (5,10,25,50)),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.service_review_reports (
 id uuid primary key default gen_random_uuid(),
 review_id uuid not null references public.service_reviews(id) on delete cascade,
 reported_by uuid not null references auth.users(id) on delete cascade,
 reason text not null check(reason in ('spam','harassment','privacy','misleading','other')),
 details text check(length(details)<=500),
 created_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','reviewed','dismissed')),
 unique(reported_by,review_id)
);
create index service_review_reports_queue_idx on public.service_review_reports(status,created_at);

alter table public.service_reviews enable row level security;
alter table public.service_favorites enable row level security;
alter table public.user_service_preferences enable row level security;
alter table public.service_review_reports enable row level security;
revoke all on public.service_reviews,public.service_favorites,public.user_service_preferences,public.service_review_reports from public,anon,authenticated;
-- Public readers cannot even SELECT or filter by reviewer auth IDs.
grant select(id,google_place_id,rating,comment,created_at,updated_at) on public.service_reviews to anon,authenticated;
create policy published_service_reviews on public.service_reviews for select to anon,authenticated using(deleted_at is null and hidden_at is null);
grant select(google_place_id,created_at) on public.service_favorites to authenticated;
create policy own_service_favorites on public.service_favorites for select to authenticated using(user_id=auth.uid());
grant select(postal_code,radius_miles,created_at,updated_at) on public.user_service_preferences to authenticated;
create policy own_service_preferences on public.user_service_preferences for select to authenticated using(user_id=auth.uid());
grant select(id,review_id,reason,details,created_at,status) on public.service_review_reports to authenticated;
create policy own_service_reports on public.service_review_reports for select to authenticated using(reported_by=auth.uid());

create function public.service_place_id_valid(p_place text) returns boolean language sql immutable set search_path='' as $$
 select p_place is not null and length(p_place) between 1 and 255 and p_place ~ '^[A-Za-z0-9_-]+$';
$$;
create function public.save_service_review(p_place text,p_rating integer,p_comment text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare review uuid; hidden timestamptz;
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if not public.service_place_id_valid(p_place) or p_rating is null or p_rating not between 1 and 5 or length(p_comment)>1500 then raise exception 'Invalid review'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,4));
 select id,hidden_at into review,hidden from public.service_reviews where user_id=auth.uid() and google_place_id=p_place for update;
 if hidden is not null then raise exception 'Review unavailable for editing'; end if;
 if review is null then
   if (select count(*) from public.service_reviews where user_id=auth.uid() and created_at>now()-interval '1 day')>=10 then raise exception 'Daily review limit reached'; end if;
   insert into public.service_reviews(google_place_id,user_id,rating,comment) values(p_place,auth.uid(),p_rating,nullif(btrim(p_comment),'')) returning id into review;
 else
   update public.service_reviews set rating=p_rating,comment=nullif(btrim(p_comment),''),updated_at=now(),deleted_at=null where id=review;
 end if;
 return review;
end $$;
create function public.withdraw_service_review(p_review uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 update public.service_reviews set deleted_at=coalesce(deleted_at,now()),updated_at=now() where id=p_review and user_id=auth.uid();
 if not found then raise exception 'Not authorized'; end if;
end $$;
create function public.my_service_review(p_place text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'rating',rating,'comment',comment,'deleted_at',deleted_at,'updated_at',updated_at,'hidden',hidden_at is not null)
 from public.service_reviews where google_place_id=p_place and user_id=auth.uid();
$$;
create function public.service_community_summaries(p_places text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_places is null or cardinality(p_places)>20 or exists(select 1 from unnest(p_places) p where not public.service_place_id_valid(p)) then raise exception 'Invalid places'; end if;
 select coalesce(jsonb_object_agg(place,jsonb_build_object('average',rating,'count',total)),'{}'::jsonb) into result
 from (select wanted.place,round(avg(r.rating),1) rating,count(r.id)::int total from (select distinct unnest(p_places) place) wanted
 left join public.service_reviews r on r.google_place_id=wanted.place and r.deleted_at is null and r.hidden_at is null group by wanted.place) summaries;
 return result;
end $$;
create function public.read_service_reviews(p_place text,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare summary jsonb; reviews jsonb;
begin
 if not public.service_place_id_valid(p_place) or p_offset is null or p_offset not between 0 and 1000 then raise exception 'Invalid review page'; end if;
 summary:=(public.service_community_summaries(array[p_place]))->p_place;
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'rating',r.rating,'comment',r.comment,'created_at',r.created_at,'updated_at',r.updated_at,'reviewer','Pawport Member') order by r.created_at desc,r.id),'[]'::jsonb) into reviews
 from (select id,rating,comment,created_at,updated_at from public.service_reviews where google_place_id=p_place and deleted_at is null and hidden_at is null order by created_at desc,id limit 20 offset p_offset) r;
 return jsonb_build_object('summary',summary,'reviews',reviews,'hasMore',(summary->>'count')::int>p_offset+20 and p_offset<1000);
end $$;
create function public.set_service_favorite(p_place text,p_saved boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if not public.service_place_id_valid(p_place) or p_saved is null then raise exception 'Invalid favorite'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,4));
 if p_saved then
   if exists(select 1 from public.service_favorites where user_id=auth.uid() and google_place_id=p_place) then return; end if;
   if (select count(*) from public.service_favorites where user_id=auth.uid())>=100 then raise exception 'Saved places limit reached'; end if;
   insert into public.service_favorites(user_id,google_place_id) values(auth.uid(),p_place);
 else delete from public.service_favorites where user_id=auth.uid() and google_place_id=p_place;
 end if;
end $$;
create function public.set_service_preference(p_postal text,p_radius integer default 10) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if p_postal is null then delete from public.user_service_preferences where user_id=auth.uid(); return; end if;
 if p_postal !~ '^[0-9]{5}$' or p_radius is null or p_radius not in (5,10,25,50) then raise exception 'Invalid preference'; end if;
 insert into public.user_service_preferences(user_id,postal_code,radius_miles) values(auth.uid(),p_postal,p_radius)
 on conflict(user_id) do update set postal_code=excluded.postal_code,radius_miles=excluded.radius_miles,updated_at=now();
end $$;
create function public.report_service_review(p_review uuid,p_reason text,p_details text default '') returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized'; end if;
 if p_reason is null or p_reason not in ('spam','harassment','privacy','misleading','other') or length(p_details)>500 then raise exception 'Invalid report'; end if;
 if not exists(select 1 from public.service_reviews where id=p_review and deleted_at is null and hidden_at is null) then raise exception 'Review unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,4));
 if exists(select 1 from public.service_review_reports where review_id=p_review and reported_by=auth.uid()) then raise exception 'Already reported'; end if;
 if (select count(*) from public.service_review_reports where reported_by=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'Daily report limit reached'; end if;
 insert into public.service_review_reports(review_id,reported_by,reason,details) values(p_review,auth.uid(),p_reason,nullif(btrim(p_details),''));
 -- A report does not hide or delete a review. Moderation is an operator action.
end $$;
revoke all on function public.service_place_id_valid(text),public.save_service_review(text,integer,text),public.withdraw_service_review(uuid),public.my_service_review(text),public.service_community_summaries(text[]),public.read_service_reviews(text,integer),public.set_service_favorite(text,boolean),public.set_service_preference(text,integer),public.report_service_review(uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_community_summaries(text[]),public.read_service_reviews(text,integer) to anon,authenticated;
grant execute on function public.save_service_review(text,integer,text),public.withdraw_service_review(uuid),public.my_service_review(text),public.set_service_favorite(text,boolean),public.set_service_preference(text,integer),public.report_service_review(uuid,text,text) to authenticated;
commit;
