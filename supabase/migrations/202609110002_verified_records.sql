begin;

-- Additive trust layer. Existing vaccination rows and share tokens are unchanged.
create table public.veterinary_providers (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(btrim(name)) between 1 and 120),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.provider_memberships (
 provider_id uuid not null references public.veterinary_providers(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 active boolean not null default true,
 primary key(provider_id,user_id)
);
create index provider_memberships_user_idx on public.provider_memberships(user_id);
create table public.health_documents (
 id uuid primary key default gen_random_uuid(),
 pet_id uuid not null references public.pets(id) on delete cascade,
 uploaded_by uuid references auth.users(id) on delete set null,
 original_name text not null check(length(original_name) between 1 and 180),
 object_path text not null unique,
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 byte_size integer not null check(byte_size between 1 and 3145728),
 created_at timestamptz not null default now(),
 uploaded_at timestamptz,
 unique(id,pet_id)
);
create index health_documents_pet_idx on public.health_documents(pet_id);
create table public.vaccination_documents (
 vaccination_id uuid primary key references public.vaccinations(id) on delete cascade,
 document_id uuid not null references public.health_documents(id),
 attached_by uuid references auth.users(id) on delete set null,
 attached_at timestamptz not null default now()
);
create index vaccination_documents_document_idx on public.vaccination_documents(document_id);
create table public.vaccination_provenance (
 vaccination_id uuid primary key references public.vaccinations(id) on delete cascade,
 source text not null default 'owner_entered' check(source = 'owner_entered'),
 entered_by uuid references auth.users(id) on delete set null,
 entered_at timestamptz not null default now()
);
-- Historical authors are intentionally unknown; do not invent an audit actor.
insert into public.vaccination_provenance(vaccination_id,entered_at)
 select id,created_at from public.vaccinations;
create table public.verification_requests (
 id uuid primary key default gen_random_uuid(),
 vaccination_id uuid not null references public.vaccinations(id) on delete cascade,
 provider_id uuid not null references public.veterinary_providers(id),
 requested_by uuid references auth.users(id) on delete set null,
 requested_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','verified','revoked','cancelled')),
 -- Immutable identity reference survives deletion of the verifier account.
 verified_by uuid,
 verified_at timestamptz,
 provider_name text,
 notes text check(length(notes) <= 1000),
 revoked_at timestamptz,
 check(status not in ('verified','revoked') or (verified_at is not null and provider_name is not null)),
 check(status <> 'revoked' or revoked_at is not null)
);
create unique index one_open_verification on public.verification_requests(vaccination_id) where status in ('pending','verified');
create index verification_requests_provider_idx on public.verification_requests(provider_id,status);
create table public.health_audit_events (
 id uuid primary key default gen_random_uuid(),
 household_id uuid references public.households(id) on delete set null,
 provider_id uuid references public.veterinary_providers(id),
 actor_id uuid,
 event_type text not null check(event_type in ('vaccination_created','document_uploaded','document_accessed','document_attached','verification_requested','verification_completed','verification_revoked','verification_cancelled')),
 vaccination_id uuid,
 document_id uuid,
 request_id uuid,
 occurred_at timestamptz not null default now()
);
create index health_audit_household_idx on public.health_audit_events(household_id,occurred_at);

-- Helpers have fixed paths and return only authorization decisions for the caller.
create function public.owns_health_pet(p_pet uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pets p join public.households h on h.id=p.household_id where p.id=p_pet and h.owner_id=auth.uid());
$$;
create function public.is_veterinary_member(p_provider uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.provider_memberships m join public.veterinary_providers p on p.id=m.provider_id where m.provider_id=p_provider and m.user_id=auth.uid() and m.active and p.active);
$$;
create function public.can_read_health_document(p_document uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.health_documents d where d.id=p_document and (
 public.owns_health_pet(d.pet_id) or (d.uploaded_at is not null and exists(
 select 1 from public.vaccination_documents a join public.verification_requests r on r.vaccination_id=a.vaccination_id
 where a.document_id=d.id and r.status='pending' and public.is_veterinary_member(r.provider_id)
 ))));
$$;

alter table public.veterinary_providers enable row level security;
alter table public.provider_memberships enable row level security;
alter table public.health_documents enable row level security;
alter table public.vaccination_documents enable row level security;
alter table public.vaccination_provenance enable row level security;
alter table public.verification_requests enable row level security;
alter table public.health_audit_events enable row level security;
revoke all on public.veterinary_providers,public.provider_memberships,public.health_documents,public.vaccination_documents,public.vaccination_provenance,public.verification_requests,public.health_audit_events from public,anon,authenticated;
grant select on public.veterinary_providers,public.provider_memberships,public.health_documents,public.vaccination_documents,public.vaccination_provenance,public.verification_requests,public.health_audit_events to authenticated;
create policy provider_directory on public.veterinary_providers for select to authenticated using(active or public.is_veterinary_member(id));
create policy own_memberships on public.provider_memberships for select to authenticated using(user_id=auth.uid());
create policy authorized_documents on public.health_documents for select to authenticated using(public.can_read_health_document(id));
create policy owner_document_links on public.vaccination_documents for select to authenticated using(exists(select 1 from public.vaccinations v where v.id=vaccination_id));
create policy owner_provenance on public.vaccination_provenance for select to authenticated using(exists(select 1 from public.vaccinations v where v.id=vaccination_id));
-- Providers use the minimal queue RPC, not this table (which includes owner IDs).
create policy owner_requests on public.verification_requests for select to authenticated using(exists(select 1 from public.vaccinations v where v.id=vaccination_id));
create policy owner_audit on public.health_audit_events for select to authenticated using(exists(select 1 from public.households h where h.id=household_id and h.owner_id=auth.uid()));

create function public.audit_vaccination_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.vaccination_provenance(vaccination_id,entered_by,entered_at) values(new.id,auth.uid(),new.created_at);
 insert into public.health_audit_events(household_id,actor_id,event_type,vaccination_id)
 select household_id,auth.uid(),'vaccination_created',new.id from public.pets where id=new.pet_id;
 return new;
end; $$;
create trigger vaccination_created_audit after insert on public.vaccinations for each row execute function public.audit_vaccination_created();

create function public.prepare_health_document(p_pet uuid,p_name text,p_mime text,p_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare doc_id uuid:=gen_random_uuid(); ext text; path text;
begin
 if not public.owns_health_pet(p_pet) then raise exception 'Not authorized'; end if;
 ext:=lower(substring(p_name from '\.([^.]+)$'));
 if p_name is null or length(p_name) not between 1 and 180 or p_name ~ '[[:cntrl:]/\\]' or p_size is null or p_size not between 1 and 3145728
 or p_mime is null or not ((p_mime='application/pdf' and ext='pdf') or (p_mime='image/jpeg' and ext in ('jpg','jpeg')) or (p_mime='image/png' and ext='png')) then raise exception 'Invalid document'; end if;
 perform 1 from public.pets where id=p_pet for update;
 if (select count(*) from public.health_documents where pet_id=p_pet) >= 100 then raise exception 'Document limit reached'; end if;
 path:=p_pet::text||'/'||doc_id::text||'.'||ext;
 insert into public.health_documents(id,pet_id,uploaded_by,original_name,object_path,mime_type,byte_size) values(doc_id,p_pet,auth.uid(),p_name,path,p_mime,p_size);
 return jsonb_build_object('id',doc_id,'path',path);
end; $$;
create function public.finalize_health_document(p_document uuid) returns void
language plpgsql security definer set search_path='' as $$
declare d public.health_documents;
begin
 select * into d from public.health_documents where id=p_document for update;
 if d.id is null or not public.owns_health_pet(d.pet_id) then raise exception 'Not authorized'; end if;
 if d.uploaded_at is not null then return; end if;
 if not exists(select 1 from storage.objects o where o.bucket_id='health-documents' and o.name=d.object_path and (o.metadata->>'size')::bigint=d.byte_size and o.metadata->>'mimetype'=d.mime_type) then raise exception 'Upload missing or invalid'; end if;
 update public.health_documents set uploaded_at=now() where id=d.id;
 insert into public.health_audit_events(household_id,actor_id,event_type,document_id) select household_id,auth.uid(),'document_uploaded',d.id from public.pets where id=d.pet_id;
end; $$;
create function public.attach_vaccination_document(p_vaccination uuid,p_document uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.vaccinations;
begin
 select * into v from public.vaccinations where id=p_vaccination for update;
 if v.id is null or not public.owns_health_pet(v.pet_id) then raise exception 'Not authorized'; end if;
 if exists(select 1 from public.verification_requests where vaccination_id=v.id and status in ('pending','verified')) then raise exception 'Record evidence is locked during or after verification'; end if;
 if not exists(select 1 from public.health_documents where id=p_document and pet_id=v.pet_id and uploaded_at is not null) then raise exception 'Invalid document'; end if;
 insert into public.vaccination_documents(vaccination_id,document_id,attached_by) values(v.id,p_document,auth.uid());
 insert into public.health_audit_events(household_id,actor_id,event_type,vaccination_id,document_id) select household_id,auth.uid(),'document_attached',v.id,p_document from public.pets where id=v.pet_id;
end; $$;
create function public.request_vaccination_verification(p_vaccination uuid,p_provider uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v public.vaccinations; request_id uuid;
begin
 select * into v from public.vaccinations where id=p_vaccination for update;
 if v.id is null or not public.owns_health_pet(v.pet_id) then raise exception 'Not authorized'; end if;
 if not exists(select 1 from public.veterinary_providers where id=p_provider and active) then raise exception 'Provider unavailable'; end if;
 if (select count(*) from public.verification_requests where vaccination_id=v.id) >= 20 then raise exception 'Request limit reached'; end if;
 insert into public.verification_requests(vaccination_id,provider_id,requested_by) values(v.id,p_provider,auth.uid()) returning id into request_id;
 insert into public.health_audit_events(household_id,provider_id,actor_id,event_type,vaccination_id,request_id) select household_id,p_provider,auth.uid(),'verification_requested',v.id,request_id from public.pets where id=v.pet_id;
 return request_id;
end; $$;
create function public.complete_vaccination_verification(p_request uuid,p_notes text default '') returns void
language plpgsql security definer set search_path='' as $$
declare r public.verification_requests; pet uuid;
begin
 select * into r from public.verification_requests where id=p_request for update;
 select pet_id into pet from public.vaccinations where id=r.vaccination_id;
 if r.id is null or r.status<>'pending' or not public.is_veterinary_member(r.provider_id) or public.owns_health_pet(pet) then raise exception 'Not authorized'; end if;
 if length(p_notes)>1000 then raise exception 'Notes too long'; end if;
 update public.verification_requests set status='verified',verified_by=auth.uid(),verified_at=now(),provider_name=(select name from public.veterinary_providers where id=r.provider_id),notes=nullif(btrim(p_notes),'') where id=r.id;
 insert into public.health_audit_events(household_id,provider_id,actor_id,event_type,vaccination_id,request_id) select household_id,r.provider_id,auth.uid(),'verification_completed',r.vaccination_id,r.id from public.pets where id=pet;
end; $$;
create function public.close_vaccination_verification(p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.verification_requests; pet uuid; event text;
begin
 select * into r from public.verification_requests where id=p_request for update;
 select pet_id into pet from public.vaccinations where id=r.vaccination_id;
 if r.status='pending' and public.owns_health_pet(pet) then
   update public.verification_requests set status='cancelled' where id=r.id; event:='verification_cancelled';
 elsif r.status='verified' and public.is_veterinary_member(r.provider_id) and not public.owns_health_pet(pet) then
   update public.verification_requests set status='revoked',revoked_at=now() where id=r.id; event:='verification_revoked';
 else raise exception 'Not authorized'; end if;
 insert into public.health_audit_events(household_id,provider_id,actor_id,event_type,vaccination_id,request_id) select household_id,r.provider_id,auth.uid(),event,r.vaccination_id,r.id from public.pets where id=pet;
end; $$;

-- Minimal provider disclosure: one submitted vaccination, pet name/species, and its
-- explicitly attached document only while pending. No household, microchip or history.
create function public.provider_verification_queue() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'status',r.status,'provider_id',r.provider_id,'provider_name',c.name,'requested_at',r.requested_at,'verified_at',r.verified_at,'pet_name',p.name,'species',p.species,'name',v.name,'administered_on',v.administered_on,'due_on',v.due_on,'clinic',v.clinic,'document_id',case when r.status='pending' then d.id else null end,'document_name',case when r.status='pending' then d.original_name else null end) order by r.requested_at desc),'[]'::jsonb)
 from public.verification_requests r join public.veterinary_providers c on c.id=r.provider_id join public.vaccinations v on v.id=r.vaccination_id join public.pets p on p.id=v.pet_id
 left join public.vaccination_documents a on a.vaccination_id=v.id left join public.health_documents d on d.id=a.document_id
 where public.is_veterinary_member(r.provider_id) and not public.owns_health_pet(v.pet_id) and r.status in ('pending','verified');
$$;
-- Owner trust projection; no change to the existing vaccinations API shape required.
create function public.owner_vaccination_trust(p_pet uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('vaccination_id',v.id,'source',case when d.id is not null then 'document_supported' else 'owner_entered' end,'verification_status',case when r.status='verified' then 'provider_verified' when d.id is not null then 'document_supported' else 'owner_entered' end,'verified_by',case when r.status='verified' then r.provider_name else null end,'verified_at',case when r.status='verified' then r.verified_at else null end,'verifier_id',case when r.status='verified' then r.verified_by else null end,'document_id',d.id,'request_id',r.id,'request_status',r.status)),'[]'::jsonb)
 from public.vaccinations v left join public.vaccination_documents a on a.vaccination_id=v.id left join public.health_documents d on d.id=a.document_id and d.uploaded_at is not null
 left join public.verification_requests r on r.vaccination_id=v.id and r.status in ('pending','verified') where v.pet_id=p_pet and public.owns_health_pet(v.pet_id);
$$;
create function public.log_health_document_access(p_document uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.can_read_health_document(p_document) then raise exception 'Not authorized'; end if;
 insert into public.health_audit_events(household_id,actor_id,event_type,document_id) select p.household_id,auth.uid(),'document_accessed',d.id from public.health_documents d join public.pets p on p.id=d.pet_id where d.id=p_document;
end; $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('health-documents','health-documents',false,3145728,array['application/pdf','image/jpeg','image/png']);
create policy health_document_upload on storage.objects for insert to authenticated with check(
 bucket_id='health-documents' and exists(select 1 from public.health_documents d where d.object_path=name and d.uploaded_by=auth.uid() and public.owns_health_pet(d.pet_id) and d.uploaded_at is null and d.created_at>now()-interval '1 hour')
);
create policy health_document_read on storage.objects for select to authenticated using(
 bucket_id='health-documents' and exists(select 1 from public.health_documents d where d.object_path=name and d.uploaded_at is not null and public.can_read_health_document(d.id))
);
-- No UPDATE/DELETE policy: evidence cannot be replaced after presentation.
-- Restrictive guards prevent unrelated broad existing Storage policies from opening this bucket.
create policy health_document_read_guard on storage.objects as restrictive for select to public using(bucket_id<>'health-documents' or (auth.uid() is not null and exists(select 1 from public.health_documents d where d.object_path=name and d.uploaded_at is not null and public.can_read_health_document(d.id))));
create policy health_document_insert_guard on storage.objects as restrictive for insert to public with check(bucket_id<>'health-documents' or (auth.uid() is not null and exists(select 1 from public.health_documents d where d.object_path=name and d.uploaded_by=auth.uid() and public.owns_health_pet(d.pet_id) and d.uploaded_at is null and d.created_at>now()-interval '1 hour')));
create policy health_document_update_guard on storage.objects as restrictive for update to public using(bucket_id<>'health-documents') with check(bucket_id<>'health-documents');
create policy health_document_delete_guard on storage.objects as restrictive for delete to public using(bucket_id<>'health-documents');

-- Preserve the signature, token checks, original JSON fields and grants. Only add
-- explicitly public trust fields; no document IDs/paths, notes, or individual verifier IDs.
create or replace function public.read_share_pass(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
 select jsonb_build_object(
   'expires_at', s.expires_at,
   'pet', jsonb_build_object('name',p.name,'species',p.species,'breed',p.breed,'birth_date',p.birth_date,'sex',p.sex),
   'vaccinations', coalesce((select jsonb_agg(jsonb_build_object('name',v.name,'administered_on',v.administered_on,'due_on',v.due_on,'clinic',v.clinic,
     'source',case when a.document_id is not null then 'document_supported' else 'owner_entered' end,
     'verification_status',case when r.status='verified' then 'provider_verified' when a.document_id is not null then 'document_supported' else 'owner_entered' end,
     'verified_by',case when r.status='verified' then r.provider_name else null end,
     'verified_at',case when r.status='verified' then r.verified_at else null end
   ) order by v.administered_on desc) from public.vaccinations v left join public.vaccination_documents a on a.vaccination_id=v.id left join public.verification_requests r on r.vaccination_id=v.id and r.status='verified' where v.pet_id=p.id), '[]'::jsonb)
 ) into result from public.share_passes s join public.pets p on p.id=s.pet_id
 where s.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and s.revoked_at is null and s.expires_at>now();
 return result;
end; $$;

revoke all on function public.owns_health_pet(uuid),public.is_veterinary_member(uuid),public.can_read_health_document(uuid),public.audit_vaccination_created(),public.prepare_health_document(uuid,text,text,integer),public.finalize_health_document(uuid),public.attach_vaccination_document(uuid,uuid),public.request_vaccination_verification(uuid,uuid),public.complete_vaccination_verification(uuid,text),public.close_vaccination_verification(uuid),public.provider_verification_queue(),public.owner_vaccination_trust(uuid),public.log_health_document_access(uuid) from public,anon,authenticated;
grant execute on function public.owns_health_pet(uuid),public.is_veterinary_member(uuid),public.can_read_health_document(uuid),public.prepare_health_document(uuid,text,text,integer),public.finalize_health_document(uuid),public.attach_vaccination_document(uuid,uuid),public.request_vaccination_verification(uuid,uuid),public.complete_vaccination_verification(uuid,text),public.close_vaccination_verification(uuid),public.provider_verification_queue(),public.owner_vaccination_trust(uuid),public.log_health_document_access(uuid) to authenticated;
commit;
