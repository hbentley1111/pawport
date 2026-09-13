import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type {
  DashboardOrganization,
  Team,
  BusinessAudit,
  InvitationPreview,
} from "../lib/provider-dashboard/schema";
import type { ProfileEditor, Business } from "../lib/business-profiles/schema";
test("Provider dashboard: scoped business authority, invitation lifecycle and private operational DTOs", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }),
    owner = randomUUID(),
    admin = randomUUID(),
    staff = randomUUID(),
    manager = randomUUID(),
    other = randomUUID(),
    invitee = randomUUID(),
    unconfirmed = randomUUID(),
    org = randomUUID(),
    foreign = randomUUID(),
    l1 = randomUUID(),
    l2 = randomUUID(),
    l3 = randomUUID(),
    foreignLocation = randomUUID();
  const ids: Record<string, string> = {};
  async function role(user?: string, anonymous = false) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || "",
    ]);
    if (user) await pg.exec("set role authenticated");
    else if (anonymous) await pg.exec("set role anon");
  }
  async function val<T = unknown>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ v: T }>(sql, args)).rows[0]?.v;
  }
  const invite = (
    email = "invitee@example.com",
    r = "staff",
    scope = "all",
    locations: string[] = [],
    organization = org,
  ) =>
    val<{ token: string; expiresAt: string }>(
      "select create_service_provider_invitation($1,$2,$3,$4,$5) v",
      [organization, email, r, scope, locations],
    );
  const accept = (token: string) =>
    val<string>("select accept_service_provider_invitation($1) v", [token]);
  const preview = (token: string) =>
    val<InvitationPreview | null>(
      "select service_provider_invitation_preview($1) v",
      [token],
    );
  const team = () => val<Team>("select service_provider_team($1) v", [org]);
  const dash = () =>
    val<DashboardOrganization[]>("select my_service_provider_dashboard() v");
  const scope = (member: string, s = "selected", locations = [l1]) =>
    val("select set_service_provider_member_locations($1,$2,$3,$4) v", [
      org,
      member,
      s,
      locations,
    ]);
  const change = (member: string, r = "staff") =>
    val("select update_service_provider_member_role($1,$2,$3) v", [
      org,
      member,
      r,
    ]);
  const remove = (member: string) =>
    val("select deactivate_service_provider_member($1,$2) v", [org, member]);
  const revoke = (id: string) =>
    val("select revoke_service_provider_invitation($1,$2) v", [org, id]);
  try {
    await pg.exec(
      `create role anon;create role authenticated;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
    );

    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (f >= "202609110013") continue;
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    }
    for (const [id, email] of [
      [owner, "owner@example.com"],
      [admin, "admin@example.com"],
      [staff, "staff@example.com"],
      [manager, "manager@example.com"],
      [other, "other@example.com"],
      [invitee, "invitee@example.com"],
      [unconfirmed, "unconfirmed@example.com"],
    ])
      await pg.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)",
        [id, email, id === unconfirmed ? null : new Date().toISOString()],
      );
    await pg.query(
      "insert into service_provider_organizations(id,name) values($1,'Paw & Company'),($2,'Other business')",
      [org, foreign],
    );
    for (const [id, o, place] of [
      [l1, org, "ChIJ-one"],
      [l2, org, "ChIJ-two"],
      [l3, org, "ChIJ-three"],
      [foreignLocation, foreign, "ChIJ-foreign"],
    ])
      await pg.query(
        "insert into service_provider_locations(id,organization_id,google_place_id) values($1,$2,$3)",
        [id, o, place],
      );
    for (const [user, r] of [
      [owner, "owner"],
      [admin, "admin"],
      [staff, "staff"],
      [manager, "scheduling_manager"],
    ])
      ids[user] = await val<string>(
        "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,$3) returning id v",
        [org, user, r],
      );
    await pg.query(
      "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'owner'),($1,$3,'staff')",
      [foreign, other, owner],
    );
    await pg.query(
      "insert into service_provider_location_profiles(location_id,display_name,profile_status) values($1,'Main Street','published'),($2,'South End','draft')",
      [l1, l2],
    );
    const connection = await val<string>(
      "insert into provider_connections(google_place_id,connection_type,external_system,status,credential_ref,external_account_id,external_location_id,availability_supported,last_success_at) values('ChIJ-one','grooming','ezyvet','active','vault/SECRET','PRIVATE-ACCOUNT','PRIVATE-LOCATION',true,now()) returning id v",
    );
    const beforeMembers = (
      await pg.query(
        "select id,organization_id,user_id,role,active from service_provider_memberships order by id",
      )
    ).rows;
    const beforePolicies = (
      await pg.query(
        "select * from pg_policies order by schemaname,tablename,policyname",
      )
    ).rows;
    await pg.exec(
      "create role service_role;grant usage on schema public to service_role;alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant all on functions to service_role;",
    );
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110013_provider_dashboard.sql",
        "utf8",
      ),
    );
    // Run compatibility assertions against subsequent additive migrations too.
    for (const f of (await readdir("supabase/migrations"))
      .filter(
        (f) => f.endsWith(".sql") && f > "202609110013_provider_dashboard.sql",
      )
      .sort()) {
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    }
    assert.deepEqual(
      (
        await pg.query(
          "select id,organization_id,user_id,role,active from service_provider_memberships order by id",
        )
      ).rows,
      beforeMembers,
    );
    const afterPolicies = (
      await pg.query<{
        schemaname: string;
        tablename: string;
        policyname: string;
      }>("select * from pg_policies order by schemaname,tablename,policyname")
    ).rows;
    // Phases 9B/9C add separate private document buckets. Preserve the exact old policy
    // snapshot and permit only these twelve additional policies, not arbitrary changes.
    const insurancePolicyNames = [
      "expense_document_delete_guard",
      "expense_document_insert",
      "expense_document_insert_guard",
      "expense_document_read",
      "expense_document_read_guard",
      "expense_document_update_guard",
      "insurance_document_delete_guard",
      "insurance_document_insert",
      "insurance_document_insert_guard",
      "insurance_document_read",
      "insurance_document_read_guard",
      "insurance_document_update_guard",
    ];
    const additions = afterPolicies.filter(
      (p) =>
        p.schemaname === "storage" &&
        p.tablename === "objects" &&
        insurancePolicyNames.includes(String(p.policyname)),
    );
    assert.deepEqual(
      additions.map((p) => p.policyname),
      insurancePolicyNames,
    );
    assert.deepEqual(
      afterPolicies.filter((p) => !additions.includes(p)),
      beforePolicies,
    );
    assert.ok(
      (
        await pg.query<{ location_scope: string }>(
          "select location_scope from service_provider_memberships",
        )
      ).rows.every((m) => m.location_scope === "all"),
    );
    await t.test(
      "dashboard preserves multiple organizations, profiles and safe scheduling status",
      async () => {
        await role(owner);
        const data = await dash();
        assert.equal(data.length, 2);
        const business = data.find((o) => o.id === org)!;
        assert.equal(business.locations.length, 3);
        assert.equal(business.teamSummary?.activeMembers, 4);
        const l = business.locations.find((l) => l.id === l1)!;
        assert.ok(l.publicProfileUrl);
        assert.equal(l.scheduling.availabilitySupported, true);
        assert.ok(l.scheduling.lastSuccessfulSyncAt);
        assert.equal(
          business.locations.find((l) => l.id === l2)!.scheduling.status,
          "not_connected",
        );
        assert.doesNotMatch(
          JSON.stringify(data),
          /credential|PRIVATE|external_account|external_location|pet_id|household|watch|notification|sync_events/,
        );
        await role();
        await pg.query(
          "update provider_connections set status='paused' where id=$1",
          [connection],
        );
        await role(owner);
        assert.equal(
          (await dash())
            .find((o) => o.id === org)!
            .locations.find((l) => l.id === l1)!.scheduling
            .availabilitySupported,
          false,
        );
        await role();
        await pg.query(
          "update provider_connections set status='error',last_error_code='unavailable' where id=$1",
          [connection],
        );
        await role(owner);
        assert.equal(
          (await dash())
            .find((o) => o.id === org)!
            .locations.find((l) => l.id === l1)!.scheduling.hasError,
          true,
        );
      },
    );
    await t.test(
      "location scope applies to dashboard AND old profile management reads",
      async () => {
        await role(owner);
        await scope(ids[staff]);
        await scope(ids[manager], "selected", [l2]);
        await role(staff);
        assert.deepEqual(
          (await dash())[0].locations.map((l) => l.id),
          [l1],
        );
        assert.equal((await dash())[0].teamSummary, null);
        assert.deepEqual(
          (
            await val<ProfileEditor>(
              "select service_provider_profile_editor($1) v",
              [org],
            )
          ).locations.map((l) => l.id),
          [l1],
        );
        assert.deepEqual(
          (
            await val<Business[]>("select my_service_provider_businesses() v")
          )[0].locations.map((l) => l.id),
          [l1],
        );
        assert.equal(
          await val("select service_provider_can_access_location($1,$2) v", [
            org,
            l2,
          ]),
          false,
        );
        await role(manager);
        assert.deepEqual(
          (await dash())[0].locations.map((l) => l.id),
          [l2],
        );
        await role(admin);
        assert.equal((await dash())[0].locations.length, 3);
        await scope(ids[staff], "all", []);
        await role(staff);
        assert.equal((await dash())[0].locations.length, 3);
        await role(owner);
        await assert.rejects(scope(ids[staff], "selected", []));
        await assert.rejects(scope(ids[staff], "selected", [foreignLocation]));
        await assert.rejects(scope(ids[owner]));
        await assert.rejects(scope(ids[admin]));
        await role();
        await pg.query(
          "update service_provider_locations set status='suspended' where id=$1",
          [l3],
        );
        await role(owner);
        await assert.rejects(scope(ids[staff], "selected", [l3]));
        assert.equal(
          (await dash()).find((o) => o.id === org)!.locations.length,
          2,
        );
        await role();
        await assert.rejects(
          pg.query(
            "update service_provider_memberships set location_scope='selected' where id=$1",
            [ids[owner]],
          ),
        );
      },
    );
    let firstToken: string, firstInvitation: string;
    await t.test(
      "invitation role hierarchy, normalization, hash-only storage and one-time token response",
      async () => {
        await role(owner);
        const first = await invite(" Invitee@Example.COM ", "admin");
        firstToken = first.token;
        assert.match(first.token, /^[0-9a-f]{64}$/);
        assert.deepEqual(Object.keys(first).sort(), ["expiresAt", "token"]);
        firstInvitation = (await team()).invitations.find(
          (i) => i.email === "invitee@example.com",
        )!.id;
        await assert.rejects(invite("invitee@example.com"));
        await assert.rejects(invite("owner2@example.com", "owner"));
        const second = await invite(
          "second@example.com",
          "scheduling_manager",
          "selected",
          [l1],
        );
        assert.notEqual(second.token, first.token);
        await role();
        const row = await val<{ token_hash: string; email: string }>(
          "select to_jsonb(i) v from service_provider_invitations i where id=$1",
          [firstInvitation],
        );
        assert.equal(
          row.token_hash,
          createHash("sha256").update(first.token).digest("hex"),
        );
        assert.equal(row.email, "invitee@example.com");
        assert.ok(!JSON.stringify(row).includes(first.token));
        await role(admin);
        await invite("admin-staff@example.com");
        await invite("admin-manager@example.com", "scheduling_manager");
        await assert.rejects(
          invite("admin-admin@example.com", "admin"),
          /Role not permitted/,
        );
        for (const user of [staff, manager, other]) {
          await role(user);
          await assert.rejects(invite(), /Not authorized/);
          await assert.rejects(team());
        }
        await role(owner);
        await assert.rejects(
          invite("cross@example.com", "staff", "all", [], foreign),
          /Not authorized/,
        );
        assert.doesNotMatch(
          JSON.stringify(await team()),
          /token|hash|invited_by|user_id/,
        );
      },
    );
    await t.test(
      "preview/accept require actual confirmed Auth email; reuse and active-member changes rejected",
      async () => {
        await role(other);
        assert.equal(await preview(firstToken), null);
        await assert.rejects(accept(firstToken), /Invitation unavailable/);
        await role(owner);
        const unconfirmedToken = await invite("unconfirmed@example.com");
        await role(unconfirmed);
        assert.equal(await preview(unconfirmedToken.token), null);
        await assert.rejects(accept(unconfirmedToken.token));
        await role(invitee);
        assert.equal((await preview(firstToken))!.role, "admin");
        await accept(firstToken);
        await assert.rejects(accept(firstToken), /Invitation unavailable/);
        await role(owner);
        assert.equal(
          (await team()).members.find(
            (m) => m.displayEmail === "invitee@example.com",
          )!.role,
          "admin",
        );
        const existing = await invite(
          "staff@example.com",
          "scheduling_manager",
        );
        await role(staff);
        await assert.rejects(accept(existing.token), /already belong/);
      },
    );
    await t.test(
      "owner/admin management hierarchy, removal, inactive reactivation and identity",
      async () => {
        await role(admin);
        await change(ids[staff], "scheduling_manager");
        await assert.rejects(change(ids[staff], "admin"));
        await assert.rejects(change(ids[owner]));
        await assert.rejects(remove(ids[owner]));
        await assert.rejects(remove(ids[admin]));
        await role(owner);
        await assert.rejects(change(ids[owner], "admin"));
        await assert.rejects(remove(ids[owner]));
        await change(ids[admin], "staff");
        assert.ok(
          !(await team()).invitations.some((i) => i.email.startsWith("admin-")),
        );
        await change(ids[admin], "admin");
        await scope(ids[manager], "selected", [l1]);
        await remove(ids[manager]);
        await assert.rejects(change(ids[manager], "staff"));
        await role(manager);
        assert.deepEqual(await dash(), []);
        await assert.rejects(
          val("select service_provider_profile_editor($1) v", [org]),
        );
        await role(owner);
        const re = await invite("manager@example.com", "staff", "selected", [
          l2,
        ]);
        await role(manager);
        await accept(re.token);
        assert.deepEqual(
          (await dash())[0].locations.map((l) => l.id),
          [l2],
        );
        await role();
        assert.equal(
          await val(
            "select id v from service_provider_memberships where organization_id=$1 and user_id=$2",
            [org, manager],
          ),
          ids[manager],
        );
        await assert.rejects(
          pg.query(
            "update service_provider_memberships set user_id=$1 where id=$2",
            [other, ids[manager]],
          ),
          /immutable/,
        );
        await assert.rejects(
          pg.query(
            "insert into service_provider_membership_locations(membership_id,location_id) values($1,$2)",
            [ids[manager], foreignLocation],
          ),
          /Invalid location grant/,
        );
      },
    );
    await t.test(
      "revocation/acceptance outcomes, expiration, location suspension and lost inviter authority",
      async () => {
        await role(owner);
        const rev = await invite("revoked@example.com");
        const inv = (await team()).invitations.find(
          (i) => i.email === "revoked@example.com",
        )!;
        await revoke(inv.id);
        await assert.rejects(accept(rev.token));
        const expired = await invite("other@example.com");
        const exp = (await team()).invitations.find(
          (i) => i.email === "other@example.com",
        )!;
        await role();
        await pg.exec(
          "alter table service_provider_invitations disable trigger business_invite_guard",
        );
        await pg.query(
          "update service_provider_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day' where id=$1",
          [exp.id],
        );
        await pg.exec(
          "alter table service_provider_invitations enable trigger business_invite_guard",
        );
        await role(other);
        assert.equal(await preview(expired.token), null);
        await assert.rejects(accept(expired.token));
        await role(owner);
        const fresh = await invite("other@example.com", "staff", "selected", [
          l1,
        ]);
        await role();
        await pg.query(
          "update service_provider_locations set status='suspended' where id=$1",
          [l1],
        );
        await role(other);
        await assert.rejects(accept(fresh.token), /Location unavailable/);
        await role();
        await pg.query(
          "update service_provider_locations set status='active' where id=$1",
          [l1],
        );
        await role(other);
        await accept(fresh.token);
        await role(owner);
        const accepted = await val<string>(
          "select id v from service_provider_invitations where token_hash=encode(extensions.digest($1,'sha256'),'hex')",
          [fresh.token],
        ).catch(() => null);
        assert.equal(accepted, null); // no raw-table access
        await role();
        const lostAuthorityUser = randomUUID();
        await pg.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'new@example.com',now())",
          [lostAuthorityUser],
        );
        await role(owner);
        const token = await invite("new@example.com");
        await role();
        await pg.query(
          "update service_provider_memberships set active=false where id=$1",
          [ids[owner]],
        );
        await role(lostAuthorityUser);
        await assert.rejects(accept(token.token));
        await role();
        await pg.query(
          "update service_provider_memberships set active=true where id=$1",
          [ids[owner]],
        );
      },
    );
    await t.test(
      "audit is private, append-only and contains no tokens; suspension disables team actions",
      async () => {
        await role(owner);
        const audit = await val<BusinessAudit[]>(
          "select service_provider_audit_history($1) v",
          [org],
        );
        for (const type of [
          "invitation_created",
          "invitation_revoked",
          "invitation_accepted",
          "member_role_changed",
          "member_location_access_changed",
          "member_deactivated",
        ])
          assert.ok(audit.some((a) => a.eventType === type));
        assert.ok(!JSON.stringify(audit).includes(firstToken));
        await role(staff);
        await assert.rejects(
          val("select service_provider_audit_history($1) v", [org]),
        );
        await role();
        await assert.rejects(
          pg.query("delete from service_provider_audit_events"),
          /append-only/,
        );
        await pg.query(
          "update service_provider_organizations set status='suspended' where id=$1",
          [org],
        );
        await role(owner);
        await assert.rejects(invite(), /Business unavailable/);
        await assert.rejects(team());
        assert.equal(
          (await dash()).find((o) => o.id === org)!.locations.length,
          0,
        );
        await role();
        await pg.query(
          "update service_provider_organizations set status='active' where id=$1",
          [org],
        );
      },
    );
    await t.test(
      "business memberships grant no veterinary/integration authority or public team access",
      async () => {
        await role();
        assert.equal(
          await val<number>(
            "select count(*)::integer v from provider_memberships",
          ),
          0,
        );
        assert.equal(
          await val<number>(
            "select count(*)::integer v from provider_scheduling_permissions",
          ),
          0,
        );
        for (const user of [owner, admin, staff, manager]) {
          await role(user);
          await assert.rejects(
            val("select set_scheduling_connection_status($1,$2) v", [
              connection,
              "paused",
            ]),
          );
          assert.deepEqual(
            await val("select provider_verification_queue() v"),
            [],
          );
        }
        await role(undefined, true);
        await assert.rejects(dash());
        await assert.rejects(team());
        await assert.rejects(preview(firstToken));
        const profile = await val<Record<string, unknown>>(
          "select service_provider_public_profile($1) v",
          [l1],
        );
        assert.ok(profile);
        assert.doesNotMatch(
          JSON.stringify(profile),
          /@example|invitation|membership|audit/,
        );
        await role();
        await pg.exec("set role service_role");
        for (const table of [
          "service_provider_invitations",
          "service_provider_audit_events",
          "service_provider_membership_locations",
          "service_provider_invitation_locations",
        ])
          await assert.rejects(
            pg.query("select * from " + table),
            /permission denied/,
          );
        await assert.rejects(
          val("select bd_auth_email() v"),
          /permission denied/,
        );
      },
    );
    await t.test(
      "inviter daily limit and organization pending limit are enforced under serialized writes",
      async () => {
        await role();
        const capOrg = randomUUID(),
          capOther = randomUUID(),
          actors = [randomUUID(), randomUUID(), randomUUID()];
        await pg.query(
          "insert into service_provider_organizations(id,name) values($1,'Capacity test'),($2,'Second capacity')",
          [capOrg, capOther],
        );
        for (const id of actors) {
          await pg.query(
            "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
            [id, id + "@example.com"],
          );
          await pg.query(
            "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'owner'),($3,$2,'owner')",
            [capOrg, id, capOther],
          );
        }
        for (let a = 0; a < 3; a++) {
          await role(actors[a]);
          for (let i = 0; i < (a === 2 ? 10 : 20); i++)
            await invite(
              `cap-${a}-${i}@example.com`,
              "staff",
              "all",
              [],
              capOrg,
            );
          if (a === 0)
            await assert.rejects(
              invite("over-rate@example.com", "staff", "all", [], capOther),
              /rate limit/,
            );
        }
        await assert.rejects(
          invite("over-capacity@example.com", "staff", "all", [], capOrg),
          /Pending invitation limit/,
        );
      },
    );
    await t.test(
      "duplicate acceptance creates one membership; revoked and accepted states are final",
      async () => {
        await role();
        const racer = randomUUID();
        await pg.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'race@example.com',now())",
          [racer],
        );
        await role(owner);
        const token = await invite("race@example.com");
        const i = (await team()).invitations.find(
          (i) => i.email === "race@example.com",
        )!;
        await role(racer);
        const outcomes = await Promise.allSettled([
          accept(token.token),
          accept(token.token),
        ]);
        assert.equal(
          outcomes.filter((r) => r.status === "fulfilled").length,
          1,
        );
        await role(owner);
        await assert.rejects(revoke(i.id), /Invitation unavailable/);
        await role();
        assert.equal(
          await val<number>(
            "select count(*)::integer v from service_provider_memberships where organization_id=$1 and user_id=$2",
            [org, racer],
          ),
          1,
        );
        const revokedUser = randomUUID();
        await pg.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'revoked-race@example.com',now())",
          [revokedUser],
        );
        await role(owner);
        const rev = await invite("revoked-race@example.com");
        const ri = (await team()).invitations.find(
          (i) => i.email === "revoked-race@example.com",
        )!;
        await revoke(ri.id);
        await role(revokedUser);
        await assert.rejects(accept(rev.token), /Invitation unavailable/);
      },
    );
  } finally {
    await pg.close();
  }
});
