begin;
-- Business roles remain independent of veterinary and integration permissions.
alter table public.service_provider_memberships add column location_scope text not null default 'all' check(location_scope in ('all','selected'));
alter table public.service_provider_memberships add constraint business_management_all_locations check(role not in ('owner','admin') or location_scope='all');
create table public.service_provider_membership_locations (
 membership_id uuid not null references public.service_provider_memberships(id),location_id uuid not null references public.service_provider_locations(id),created_at timestamptz not null default now(),primary key(membership_id,location_id)
);
create table public.service_provider_invitations (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.service_provider_organizations(id),
 email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254 and public.bp_email(email)),
 role text not null check(role in ('admin','staff','scheduling_manager')),location_scope text not null check(location_scope in ('all','selected')),
 token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),status text not null default 'pending' check(status in ('pending','accepted','revoked','expired')),
 invited_by uuid not null references auth.users(id),expires_at timestamptz not null default now()+interval '7 days',accepted_by uuid references auth.users(id),accepted_at timestamptz,revoked_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(role<>'admin' or location_scope='all'),check(expires_at>created_at and expires_at<=created_at+interval '7 days'),
 check((status='accepted' and accepted_by is not null and accepted_at is not null and revoked_at is null) or (status='revoked' and accepted_by is null and accepted_at is null and revoked_at is not null) or (status in ('pending','expired') and accepted_by is null and accepted_at is null and revoked_at is null))
);
create unique index service_provider_pending_invitation on public.service_provider_invitations(organization_id,email) where status='pending';
create index service_provider_inviter_recent on public.service_provider_invitations(invited_by,created_at);
create table public.service_provider_invitation_locations (
 invitation_id uuid not null references public.service_provider_invitations(id),location_id uuid not null references public.service_provider_locations(id),created_at timestamptz not null default now(),primary key(invitation_id,location_id)
);
create table public.service_provider_audit_events (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.service_provider_organizations(id),actor_id uuid references auth.users(id),
 event_type text not null check(event_type in ('invitation_created','invitation_revoked','invitation_accepted','member_role_changed','member_location_access_changed','member_deactivated')),
 target_membership_id uuid references public.service_provider_memberships(id),invitation_id uuid references public.service_provider_invitations(id),location_id uuid references public.service_provider_locations(id),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=1000 and metadata-array['role','scope','from']='{}'::jsonb and (not metadata?'role' or metadata->>'role' in ('owner','admin','staff','scheduling_manager')) and (not metadata?'from' or metadata->>'from' in ('owner','admin','staff','scheduling_manager')) and (not metadata?'scope' or metadata->>'scope' in ('all','selected'))),created_at timestamptz not null default now()
);
create index service_provider_audit_recent on public.service_provider_audit_events(organization_id,created_at desc,id desc);
-- Matches the actual dashboard lookup, not a duplicate scheduling identity.
create index provider_connection_place_summary on public.provider_connections(google_place_id,updated_at desc,id) where google_place_id is not null;
create function public.service_provider_can_access_location(p_organization uuid,p_location uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.service_provider_memberships m join public.service_provider_organizations o on o.id=m.organization_id join public.service_provider_locations l on l.organization_id=o.id where o.id=p_organization and o.status='active' and l.id=p_location and l.status='active' and m.user_id=auth.uid() and m.active and (m.location_scope='all' or exists(select 1 from public.service_provider_membership_locations g where g.membership_id=m.id and g.location_id=l.id)))
$$;
create function public.bd_actor(p_org uuid) returns text language plpgsql security definer set search_path='' as $$
declare r text;begin perform public.bp_authorize(p_org);select role into r from public.service_provider_memberships where organization_id=p_org and user_id=auth.uid() and active;return r;end $$;
create function public.bd_validate_scope(p_org uuid,p_role text,p_scope text,p_locations uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_scope is null or p_scope not in ('all','selected') or p_locations is null or cardinality(p_locations)>100 or cardinality(p_locations)<>(select count(distinct x) from unnest(p_locations)x) or (p_role in ('owner','admin') and p_scope<>'all') or (p_scope='all' and cardinality(p_locations)<>0) or (p_scope='selected' and cardinality(p_locations)=0) then raise exception 'Invalid location scope';end if;
 -- Location row locks serialize new grants with suspension. Organization lock is acquired first by callers.
 perform 1 from public.service_provider_locations where id=any(p_locations) and organization_id=p_org and status='active' order by id for share;
 if (select count(*) from public.service_provider_locations where id=any(p_locations) and organization_id=p_org and status='active')<>cardinality(p_locations) then raise exception 'Location unavailable';end if;
end $$;
create function public.bd_grant_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare org uuid;scope text;begin
 if tg_op='UPDATE' then raise exception 'Location grant identity immutable';end if;
 if tg_table_name='service_provider_membership_locations' then select organization_id,location_scope into org,scope from public.service_provider_memberships where id=new.membership_id;
 else select organization_id,location_scope into org,scope from public.service_provider_invitations where id=new.invitation_id;end if;
 if scope<>'selected' or not exists(select 1 from public.service_provider_locations where id=new.location_id and organization_id=org and status='active') then raise exception 'Invalid location grant';end if;return new;
end $$;
create trigger business_member_location_guard before insert or update on public.service_provider_membership_locations for each row execute function public.bd_grant_guard();
create trigger business_invite_location_guard before insert or update on public.service_provider_invitation_locations for each row execute function public.bd_grant_guard();
-- Deferred constraints allow atomic scope replacement but prevent empty selected scopes.
create function public.bd_scope_integrity() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;scope text;n integer;begin
 if tg_table_name='service_provider_memberships' then target:=coalesce(new.id,old.id);
 elsif tg_table_name='service_provider_invitations' then target:=coalesce(new.id,old.id);
 elsif tg_table_name='service_provider_membership_locations' then target:=coalesce(new.membership_id,old.membership_id);
 else target:=coalesce(new.invitation_id,old.invitation_id);end if;
 if tg_table_name in ('service_provider_memberships','service_provider_membership_locations') then select location_scope into scope from public.service_provider_memberships where id=target;select count(*) into n from public.service_provider_membership_locations where membership_id=target;
 else select location_scope into scope from public.service_provider_invitations where id=target;select count(*) into n from public.service_provider_invitation_locations where invitation_id=target;end if;
 if (scope='selected' and n=0) or (scope='all' and n>0) then raise exception 'Location scope requires matching grants';end if;return null;
end $$;
create constraint trigger business_member_scope after insert or update on public.service_provider_memberships deferrable initially deferred for each row execute function public.bd_scope_integrity();
create constraint trigger business_member_grants after insert or update or delete on public.service_provider_membership_locations deferrable initially deferred for each row execute function public.bd_scope_integrity();
create constraint trigger business_invite_scope after insert or update on public.service_provider_invitations deferrable initially deferred for each row execute function public.bd_scope_integrity();
create constraint trigger business_invite_grants after insert or update or delete on public.service_provider_invitation_locations deferrable initially deferred for each row execute function public.bd_scope_integrity();
create function public.bd_invitation_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.id,new.organization_id,new.email,new.role,new.location_scope,new.token_hash,new.invited_by,new.expires_at,new.created_at) is distinct from (old.id,old.organization_id,old.email,old.role,old.location_scope,old.token_hash,old.invited_by,old.expires_at,old.created_at) then raise exception 'Invitation identity immutable';end if;
 if old.status<>'pending' then raise exception 'Invitation is final';end if;new.updated_at:=now();return new;
end $$;
create trigger business_invite_guard before update on public.service_provider_invitations for each row execute function public.bd_invitation_guard();
create function public.bd_audit_guard() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Business audit is append-only';end $$;
create trigger business_audit_immutable before update or delete on public.service_provider_audit_events for each row execute function public.bd_audit_guard();
create function public.bd_audit(p_org uuid,p_type text,p_member uuid default null,p_invite uuid default null,p_meta jsonb default '{}') returns void language sql security definer set search_path='' as $$
 insert into public.service_provider_audit_events(organization_id,actor_id,event_type,target_membership_id,invitation_id,metadata) values(p_org,auth.uid(),p_type,p_member,p_invite,p_meta)
$$;
create function public.create_service_provider_invitation(p_organization uuid,p_email text,p_role text,p_scope text,p_locations uuid[] default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text;token text;v uuid;begin
 if auth.uid() is null then raise exception 'Not authorized';end if;
 perform pg_advisory_xact_lock(hashtextextended('business-inviter:'||auth.uid(),0));
 actor:=public.bd_actor(p_organization);
 if p_role is null or p_role not in ('admin','staff','scheduling_manager') or (actor='admin' and p_role='admin') then raise exception 'Role not permitted';end if;
 perform public.bd_validate_scope(p_organization,p_role,p_scope,p_locations);
 if (select count(*) from public.service_provider_memberships where organization_id=p_organization and active)>=200 then raise exception 'Team capacity reached';end if;
 if p_email is null or length(p_email)>254 or not public.bp_email(lower(btrim(p_email))) then raise exception 'Invalid email';end if;
 update public.service_provider_invitations set status='expired' where organization_id=p_organization and status='pending' and expires_at<=now();
 if (select count(*) from public.service_provider_invitations where organization_id=p_organization and status='pending')>=50 then raise exception 'Pending invitation limit reached';end if;
 if (select count(*) from public.service_provider_invitations where invited_by=auth.uid() and created_at>now()-interval '24 hours')>=20 then raise exception 'Invitation rate limit reached';end if;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.service_provider_invitations(organization_id,email,role,location_scope,token_hash,invited_by) values(p_organization,lower(btrim(p_email)),p_role,p_scope,encode(extensions.digest(token,'sha256'),'hex'),auth.uid()) returning id into v;
 insert into public.service_provider_invitation_locations(invitation_id,location_id) select v,unnest(p_locations);
 perform public.bd_audit(p_organization,'invitation_created',null,v,jsonb_build_object('role',p_role,'scope',p_scope));
 return jsonb_build_object('token',token,'expiresAt',now()+interval '7 days');
end $$;
-- Use the actual Auth record, never browser/JWT email claims. Confirmed email is required.
create function public.bd_auth_email() returns text language plpgsql stable security definer set search_path='' as $$
declare e text;begin if auth.uid() is null then return null;end if;select lower(btrim(email)) into e from auth.users where id=auth.uid() and email_confirmed_at is not null;return e;end $$;
create function public.service_provider_invitation_preview(p_token text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or public.bd_auth_email() is null then return null;end if;
 return(select jsonb_build_object('organizationName',o.name,'role',i.role,'locationScope',i.location_scope,'locations',coalesce((select jsonb_agg(coalesce(p.display_name,o.name) order by l.id) from public.service_provider_invitation_locations g join public.service_provider_locations l on l.id=g.location_id left join public.service_provider_location_profiles p on p.location_id=l.id where g.invitation_id=i.id),'[]'::jsonb),'expiresAt',i.expires_at)
 from public.service_provider_invitations i join public.service_provider_organizations o on o.id=i.organization_id where i.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and i.status='pending' and i.expires_at>now() and o.status='active' and i.email=public.bd_auth_email());
end $$;
create function public.accept_service_provider_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.service_provider_invitations;v_org uuid;v_member uuid;locs uuid[];e text;begin
 e:=public.bd_auth_email();
 if e is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'Invitation unavailable';end if;
 select organization_id into v_org from public.service_provider_invitations where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
 -- Same lock order as revocation, role changes and profile writes: organization then child.
 perform 1 from public.service_provider_organizations where id=v_org and status='active' for update;if not found then raise exception 'Invitation unavailable';end if;
 select * into i from public.service_provider_invitations where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
 if i.status<>'pending' or i.expires_at<=now() or i.email<>e then raise exception 'Invitation unavailable';end if;
 perform 1 from public.service_provider_memberships where organization_id=v_org and user_id=i.invited_by and active and (role='owner' or (role='admin' and i.role<>'admin')) for share;if not found then raise exception 'Invitation unavailable';end if;
 select id into v_member from public.service_provider_memberships where organization_id=v_org and user_id=auth.uid() for update;
 if exists(select 1 from public.service_provider_memberships where id=v_member and (active or role='owner')) then raise exception 'You already belong to this business';end if;
 select coalesce(array_agg(location_id order by location_id),'{}'::uuid[]) into locs from public.service_provider_invitation_locations where invitation_id=i.id;
 perform public.bd_validate_scope(v_org,i.role,i.location_scope,locs);
 -- An admin invitation cannot reactivate a previously privileged admin membership via a lower-role invite.
 if v_member is not null and exists(select 1 from public.service_provider_memberships where id=v_member and role='admin') and not exists(select 1 from public.service_provider_memberships where organization_id=v_org and user_id=i.invited_by and active and role='owner') then raise exception 'Invitation unavailable';end if;
 if (select count(*) from public.service_provider_memberships where organization_id=v_org and active)>=200 then raise exception 'Team capacity reached';end if;
 if v_member is null then insert into public.service_provider_memberships(organization_id,user_id,role,location_scope) values(v_org,auth.uid(),i.role,i.location_scope) returning id into v_member;
 else delete from public.service_provider_membership_locations where membership_id=v_member;update public.service_provider_memberships set active=true,role=i.role,location_scope=i.location_scope where id=v_member;end if;
 insert into public.service_provider_membership_locations(membership_id,location_id) select v_member,unnest(locs);
 update public.service_provider_invitations set status='accepted',accepted_by=auth.uid(),accepted_at=now() where id=i.id;
 perform public.bd_audit(v_org,'invitation_accepted',v_member,i.id,jsonb_build_object('role',i.role,'scope',i.location_scope));
 return v_org;
end $$;
create function public.revoke_service_provider_invitation(p_organization uuid,p_invitation uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor text;i public.service_provider_invitations;begin
 actor:=public.bd_actor(p_organization);select * into i from public.service_provider_invitations where id=p_invitation and organization_id=p_organization for update;
 if not found or (actor='admin' and i.role='admin') then raise exception 'Not authorized';end if;
 if i.status='revoked' then return;end if;if i.status<>'pending' then raise exception 'Invitation unavailable';end if;
 update public.service_provider_invitations set status='revoked',revoked_at=now() where id=i.id;perform public.bd_audit(p_organization,'invitation_revoked',null,i.id);
end $$;
create function public.bd_target(p_org uuid,p_member uuid,p_new_role text default null) returns public.service_provider_memberships language plpgsql security definer set search_path='' as $$
declare actor text;m public.service_provider_memberships;begin
 actor:=public.bd_actor(p_org);select * into m from public.service_provider_memberships where id=p_member and organization_id=p_org for update;
 if not found or not m.active or m.role='owner' or m.user_id=auth.uid() or (actor='admin' and (m.role='admin' or p_new_role='admin')) then raise exception 'Member change not permitted';end if;return m;
end $$;
create function public.bd_revoke_issued(p_org uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare v uuid;begin for v in update public.service_provider_invitations set status='revoked',revoked_at=now() where organization_id=p_org and invited_by=p_user and status='pending' returning id loop perform public.bd_audit(p_org,'invitation_revoked',null,v);end loop;end $$;
create function public.update_service_provider_member_role(p_organization uuid,p_member uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
declare m public.service_provider_memberships;begin
 if p_role is null or p_role not in ('admin','staff','scheduling_manager') then raise exception 'Role not permitted';end if;
 m:=public.bd_target(p_organization,p_member,p_role);if m.role=p_role then return;end if;
 if p_role='admin' then delete from public.service_provider_membership_locations where membership_id=m.id;end if;
 update public.service_provider_memberships set role=p_role,location_scope=case when p_role='admin' then 'all' else location_scope end where id=m.id;
 perform public.bd_audit(p_organization,'member_role_changed',m.id,null,jsonb_build_object('from',m.role,'role',p_role));
 -- Revoke pending authority issued by a member who loses team-administration rights.
 if m.role='admin' and p_role<>'admin' then perform public.bd_revoke_issued(p_organization,m.user_id);end if;
end $$;
create function public.set_service_provider_member_locations(p_organization uuid,p_member uuid,p_scope text,p_locations uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare m public.service_provider_memberships;begin m:=public.bd_target(p_organization,p_member);if m.role not in ('staff','scheduling_manager') then raise exception 'Role requires all locations';end if;
 perform public.bd_validate_scope(p_organization,m.role,p_scope,p_locations);
 delete from public.service_provider_membership_locations where membership_id=m.id;update public.service_provider_memberships set location_scope=p_scope where id=m.id;
 insert into public.service_provider_membership_locations(membership_id,location_id) select m.id,unnest(p_locations);
 perform public.bd_audit(p_organization,'member_location_access_changed',m.id,null,jsonb_build_object('scope',p_scope));
end $$;
create function public.deactivate_service_provider_member(p_organization uuid,p_member uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.service_provider_memberships;begin m:=public.bd_target(p_organization,p_member);update public.service_provider_memberships set active=false where id=m.id;
 perform public.bd_revoke_issued(p_organization,m.user_id);
 perform public.bd_audit(p_organization,'member_deactivated',m.id);
end $$;
create function public.service_provider_team(p_organization uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text;begin actor:=public.bd_actor(p_organization);
 return jsonb_build_object('organizationName',(select name from public.service_provider_organizations where id=p_organization),'role',actor,
 'members',coalesce((select jsonb_agg(jsonb_build_object('membershipId',m.id,'displayEmail',u.email,'role',m.role,'active',m.active,'locationScope',m.location_scope,'isSelf',m.user_id=auth.uid(),'joinedAt',m.created_at,'locations',coalesce((select jsonb_agg(g.location_id order by g.location_id) from public.service_provider_membership_locations g where g.membership_id=m.id),'[]'::jsonb)) order by m.created_at,m.id) from(select * from public.service_provider_memberships where organization_id=p_organization order by active desc,created_at desc,id desc limit 200)m join auth.users u on u.id=m.user_id),'[]'::jsonb),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'locationScope',location_scope,'expiresAt',expires_at) order by created_at,id) from public.service_provider_invitations where organization_id=p_organization and status='pending' and expires_at>now()),'[]'::jsonb),
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',coalesce(p.display_name,o.name)) order by l.id) from public.service_provider_locations l join public.service_provider_organizations o on o.id=l.organization_id left join public.service_provider_location_profiles p on p.location_id=l.id where l.organization_id=p_organization and l.status='active'),'[]'::jsonb));
end $$;
create function public.service_provider_audit_history(p_organization uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform public.bd_actor(p_organization);return coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'eventType',e.event_type,'actorEmail',a.email,'targetEmail',coalesce(t.email,i.email),'role',e.metadata->>'role','scope',e.metadata->>'scope','createdAt',e.created_at) order by e.created_at desc,e.id desc) from(select * from public.service_provider_audit_events where organization_id=p_organization order by created_at desc,id desc limit 100)e left join auth.users a on a.id=e.actor_id left join public.service_provider_memberships m on m.id=e.target_membership_id left join auth.users t on t.id=m.user_id left join public.service_provider_invitations i on i.id=e.invitation_id),'[]'::jsonb);end $$;
-- Bounded read-only capability summary; no owner/pet/connection secrets or mutation authority.
create function public.my_service_provider_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Not authorized';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',o.status,'role',o.role,'locationScope',o.location_scope,
 'teamSummary',case when o.status='active' and o.role in ('owner','admin') then jsonb_build_object('activeMembers',(select count(*) from public.service_provider_memberships where organization_id=o.id and active),'pendingInvitations',(select count(*) from public.service_provider_invitations where organization_id=o.id and status='pending' and expires_at>now())) end,
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'displayName',coalesce(p.display_name,o.name),'profileStatus',coalesce(p.profile_status,'draft'),'publicProfileUrl',case when p.profile_status='published' then '/providers/'||l.id end,'googlePlaceId',l.google_place_id,
 'scheduling',jsonb_build_object('connected',coalesce(c.status='active',false),'status',coalesce(c.status,'not_connected'),'system',c.external_system,'availabilitySupported',coalesce(c.status='active' and c.availability_supported and (c.external_system<>'mock' or (select demo_enabled from public.availability_runtime_settings where singleton)),false),'lastSuccessfulSyncAt',c.last_success_at,'hasError',coalesce(c.last_error_code is not null,false))) order by l.id)
 from(select * from public.service_provider_locations where organization_id=o.id and public.service_provider_can_access_location(o.id,id) order by id limit 100)l left join public.service_provider_location_profiles p on p.location_id=l.id
 left join lateral(select status,external_system,availability_supported,last_success_at,last_error_code from public.provider_connections where google_place_id=l.google_place_id order by (status='active') desc,updated_at desc,id limit 1)c on true),'[]'::jsonb)) order by o.name,o.id)
 from(select o.id,o.name,o.status,m.role,m.location_scope from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id where m.user_id=auth.uid() and m.active order by o.name,o.id limit 100)o),'[]'::jsonb);
end $$;
create or replace function public.bp_authorize(p_org uuid,p_location uuid default null,p_edit boolean default true) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authorized';end if;
 perform 1 from public.service_provider_organizations where id=p_org and status='active' for update;
 if not found then raise exception 'Business unavailable';end if;
 perform 1 from public.service_provider_memberships where organization_id=p_org and user_id=auth.uid() and active and (not p_edit or role in ('owner','admin')) for share;
 if not found then raise exception 'Not authorized';end if;
 if p_location is not null then
 perform 1 from public.service_provider_locations where id=p_location and organization_id=p_org and status='active' for update;
 if not found or not public.service_provider_can_access_location(p_org,p_location) then raise exception 'Location unavailable';end if;end if;
end $$;
create or replace function public.my_service_provider_businesses() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin if auth.uid() is null then raise exception 'Not authorized';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'status',x.status,'role',x.role,'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.display_name,'status',l.status,'profileStatus',coalesce(l.profile_status,'draft')) order by l.id) from(select l.id,l.status,p.display_name,p.profile_status from public.service_provider_locations l left join public.service_provider_location_profiles p on p.location_id=l.id where l.organization_id=x.id and public.service_provider_can_access_location(x.id,l.id) order by l.id limit 100)l),'[]'::jsonb)) order by x.name,x.id) from(select o.id,o.name,o.status,m.role from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id where m.user_id=auth.uid() and m.active order by o.name,o.id limit 100)x),'[]'::jsonb);end $$;
create or replace function public.service_provider_profile_editor(p_organization uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 perform public.bp_authorize(p_organization,null,false);
 select jsonb_build_object('id',o.id,'name',o.name,'canEdit',m.role in ('owner','admin'),'tagline',p.tagline,'description',p.description,'website_url',p.website_url,'public_email',p.public_email,'public_phone',p.public_phone,
 'logoUrl',case when p.logo_asset_id is not null then '/provider/businesses/'||o.id||'/logo' end,
 'locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'status',l.status,'profileStatus',coalesce(l.profile_status,'draft'),'fields',jsonb_build_object('display_name',l.display_name,'address_line1',l.address_line1,'address_line2',l.address_line2,'city',l.city,'region',l.region,'postal_code',l.postal_code,'country_code',l.country_code,'public_phone',l.public_phone,'website_url',l.website_url,'time_zone',l.time_zone),'preview',public.bp_profile(l.id)) order by l.id) from(select l.id,l.status,p.* from public.service_provider_locations l left join public.service_provider_location_profiles p on p.location_id=l.id where l.organization_id=o.id and public.service_provider_can_access_location(o.id,l.id) order by l.id limit 100)l),'[]'::jsonb)) into result
 from public.service_provider_organizations o join public.service_provider_memberships m on m.organization_id=o.id and m.user_id=auth.uid() and m.active left join public.service_provider_organization_profiles p on p.organization_id=o.id where o.id=p_organization;
 return result;
end $$;
alter table public.service_provider_membership_locations enable row level security;
revoke all on public.service_provider_membership_locations from public,anon,authenticated;
alter table public.service_provider_invitations enable row level security;
revoke all on public.service_provider_invitations from public,anon,authenticated;
alter table public.service_provider_invitation_locations enable row level security;
revoke all on public.service_provider_invitation_locations from public,anon,authenticated;
alter table public.service_provider_audit_events enable row level security;
revoke all on public.service_provider_audit_events from public,anon,authenticated;
do $$ declare f record;t text;begin foreach t in array array['service_provider_membership_locations','service_provider_invitations','service_provider_invitation_locations','service_provider_audit_events'] loop if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on public.%I from service_role',t);end if;end loop;
for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['service_provider_can_access_location','bd_actor','bd_validate_scope','bd_grant_guard','bd_scope_integrity','bd_invitation_guard','bd_audit_guard','bd_audit','create_service_provider_invitation','bd_auth_email','service_provider_invitation_preview','accept_service_provider_invitation','revoke_service_provider_invitation','bd_target','bd_revoke_issued','update_service_provider_member_role','set_service_provider_member_locations','deactivate_service_provider_member','service_provider_team','service_provider_audit_history','my_service_provider_dashboard','bp_authorize','my_service_provider_businesses','service_provider_profile_editor']) loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);if exists(select 1 from pg_roles where rolname='service_role') then execute format('revoke all on function %s from service_role',f.signature);end if;end loop;end $$;
grant execute on function public.my_service_provider_businesses(),public.service_provider_profile_editor(uuid),public.service_provider_can_access_location(uuid,uuid),public.create_service_provider_invitation(uuid,text,text,text,uuid[]),public.service_provider_invitation_preview(text),public.accept_service_provider_invitation(text),public.revoke_service_provider_invitation(uuid,uuid),public.update_service_provider_member_role(uuid,uuid,text),public.set_service_provider_member_locations(uuid,uuid,text,uuid[]),public.deactivate_service_provider_member(uuid,uuid),public.service_provider_team(uuid),public.service_provider_audit_history(uuid),public.my_service_provider_dashboard() to authenticated;
commit;
