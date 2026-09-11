-- One owner and one pet per household in this deliberately small MVP.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.households (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null unique references auth.users(id) on delete cascade default auth.uid(),
 name text not null check (length(btrim(name)) between 1 and 80),
 created_at timestamptz not null default now()
);
create table public.pets (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null unique references public.households(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 60),
 species text not null check (species in ('Dog','Cat','Other')),
 breed text not null check (length(btrim(breed)) between 1 and 80),
 birth_date date check (birth_date <= current_date),
 sex text not null check (sex in ('Female','Male','Unknown')),
 microchip text check (length(microchip) <= 30 and microchip ~ '^[a-zA-Z0-9 -]*$'),
 created_at timestamptz not null default now()
);
create table public.vaccinations (
 id uuid primary key default gen_random_uuid(),
 pet_id uuid not null references public.pets(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 100),
 administered_on date not null check (administered_on <= current_date),
 due_on date check (due_on >= administered_on),
 clinic text not null check (length(btrim(clinic)) between 1 and 120),
 created_at timestamptz not null default now()
);
create index vaccinations_pet_id_idx on public.vaccinations(pet_id);
create table public.share_passes (
 id uuid primary key default gen_random_uuid(),
 pet_id uuid not null references public.pets(id) on delete cascade,
 token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null check (expires_at <= created_at + interval '7 days' and expires_at > created_at),
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index share_passes_pet_id_idx on public.share_passes(pet_id);
alter table public.households enable row level security;
alter table public.pets enable row level security;
alter table public.vaccinations enable row level security;
alter table public.share_passes enable row level security;
-- Explicit grants: no anonymous table access, no direct share creation or mutation.
revoke all on public.households, public.pets, public.vaccinations, public.share_passes from anon, authenticated;
grant select, insert on public.households, public.pets, public.vaccinations to authenticated;
grant select (id, pet_id, expires_at, revoked_at, created_at) on public.share_passes to authenticated;
create policy household_read on public.households for select to authenticated using (owner_id = (select auth.uid()));
create policy household_create on public.households for insert to authenticated with check (owner_id = (select auth.uid()));
create policy pet_read on public.pets for select to authenticated using (exists (select 1 from public.households h where h.id = household_id and h.owner_id = (select auth.uid())));
create policy pet_create on public.pets for insert to authenticated with check (exists (select 1 from public.households h where h.id = household_id and h.owner_id = (select auth.uid())));
create policy vaccination_read on public.vaccinations for select to authenticated using (exists (select 1 from public.pets p where p.id = pet_id));
create policy vaccination_create on public.vaccinations for insert to authenticated with check (exists (select 1 from public.pets p where p.id = pet_id));
create policy share_read on public.share_passes for select to authenticated using (exists (select 1 from public.pets p where p.id = pet_id));

-- Tokens are generated inside Postgres and returned only at creation. Every privileged
-- function uses a fixed search path, explicit authorization and restricted grants.
create function public.create_share_pass(p_pet_id uuid, p_hours integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare token text; expiry timestamptz; pass_id uuid;
begin
 if auth.uid() is null or not exists (select 1 from public.pets p join public.households h on h.id = p.household_id where p.id = p_pet_id and h.owner_id = auth.uid()) then raise exception 'Not authorized'; end if;
 if p_hours is null or p_hours not in (1,24,168) then raise exception 'Invalid duration'; end if;
 -- Serialize creation per pet to make the active-pass limit race-safe.
 perform 1 from public.pets where id = p_pet_id for update;
 if (select count(*) from public.share_passes where pet_id = p_pet_id and revoked_at is null and expires_at > now()) >= 5 then raise exception 'Revoke an active pass before creating another.'; end if;
 token := encode(extensions.gen_random_bytes(32), 'hex');
 expiry := now() + make_interval(hours => p_hours);
 insert into public.share_passes(pet_id,token_hash,expires_at) values(p_pet_id,encode(extensions.digest(token,'sha256'),'hex'),expiry) returning id into pass_id;
 return jsonb_build_object('id',pass_id,'token',token,'expires_at',expiry);
end; $$;
create function public.revoke_share_pass(p_pass_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.share_passes s set revoked_at = now() where s.id = p_pass_id and exists (select 1 from public.pets p join public.households h on h.id = p.household_id where p.id = s.pet_id and h.owner_id = auth.uid());
 if not found then raise exception 'Not authorized'; end if;
end; $$;
create function public.read_share_pass(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
 select jsonb_build_object(
   'expires_at', s.expires_at,
   'pet', jsonb_build_object('name',p.name,'species',p.species,'breed',p.breed,'birth_date',p.birth_date,'sex',p.sex),
   'vaccinations', coalesce((select jsonb_agg(jsonb_build_object('name',v.name,'administered_on',v.administered_on,'due_on',v.due_on,'clinic',v.clinic) order by v.administered_on desc) from public.vaccinations v where v.pet_id = p.id), '[]'::jsonb)
 ) into result from public.share_passes s join public.pets p on p.id = s.pet_id
 where s.token_hash = encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at > now();
 return result;
end; $$;
revoke all on function public.create_share_pass(uuid,integer), public.revoke_share_pass(uuid), public.read_share_pass(text) from public, anon, authenticated;
grant execute on function public.create_share_pass(uuid,integer), public.revoke_share_pass(uuid) to authenticated;
grant execute on function public.read_share_pass(text) to anon, authenticated;
