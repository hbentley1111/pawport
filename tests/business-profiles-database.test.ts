import type {
  PublicProfile,
  ProfileEditor,
} from "../lib/business-profiles/schema";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("Business profiles: authorization, publication, storage and trust boundaries", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }),
    owner = randomUUID(),
    admin = randomUUID(),
    staff = randomUUID(),
    manager = randomUUID(),
    other = randomUUID(),
    org = randomUUID(),
    location = randomUUID(),
    foreignOrg = randomUUID(),
    foreignLocation = randomUUID();
  async function role(id?: string) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    if (id) await pg.exec("set role authenticated");
  }
  async function val<T = unknown>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ v: T }>(sql, args)).rows[0]?.v;
  }
  const save = (data: Record<string, unknown> = {}) =>
    val("select save_service_provider_organization_profile($1,$2) v", [
      org,
      { name: "Independent provider name", ...data },
    ]);
  const publish = (status = "published") =>
    val("select set_service_provider_profile_status($1,$2,$3) v", [
      org,
      location,
      status,
    ]);
  const pub = () =>
    val<PublicProfile>("select service_provider_public_profile($1) v", [
      location,
    ]);
  try {
    await pg.exec(
      `create role anon;create role authenticated;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
    );

    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (f.includes("012_business_profiles"))
        await pg.exec(
          "create role service_role;grant usage on schema public to service_role;alter default privileges in schema public grant all on tables to service_role;alter default privileges in schema public grant all on functions to service_role;",
        );
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    }
    await pg.query(
      "insert into auth.users(id) values($1),($2),($3),($4),($5)",
      [owner, admin, staff, manager, other],
    );
    await pg.query(
      "insert into service_provider_organizations(id,name) values($1,'Owner-entered'),($2,'Other business')",
      [org, foreignOrg],
    );
    await pg.query(
      "insert into service_provider_locations(id,organization_id,google_place_id) values($1,$2,'ChIJ-profile'),($3,$4,'ChIJ-other')",
      [location, org, foreignLocation, foreignOrg],
    );
    for (const [user, r] of [
      [owner, "owner"],
      [admin, "admin"],
      [staff, "staff"],
      [manager, "scheduling_manager"],
    ])
      await pg.query(
        "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,$3)",
        [org, user, r],
      );
    await pg.query(
      "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'owner')",
      [foreignOrg, other],
    );
    // Real private health fixture verifies the inherited restrictive Storage guard.
    await role(other);
    const household = await val<string>(
      "insert into households(name) values('Private family') returning id v",
    );
    const pet = await val<string>(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Private pet','Dog','Mixed','Female') returning id v",
      [household],
    );
    await role();
    await pg.query(
      "insert into health_documents(pet_id,uploaded_by,original_name,object_path,mime_type,byte_size,uploaded_at) values($1,$2,'Private record','PRIVATE-HEALTH-PATH','application/pdf',1,now())",
      [pet, other],
    );
    await pg.exec(
      "insert into storage.objects(bucket_id,name,metadata) values('health-documents','PRIVATE-HEALTH-PATH','{}')",
    );
    await t.test(
      "private medical Storage access remains owner-only; default grants cannot expose profile helpers",
      async () => {
        await role();
        await pg.exec("set role anon");
        assert.equal(
          (
            await pg.query(
              "select * from storage.objects where bucket_id='health-documents'",
            )
          ).rows.length,
          0,
        );
        await role(owner);
        assert.equal(
          (
            await pg.query(
              "select * from storage.objects where bucket_id='health-documents'",
            )
          ).rows.length,
          0,
        );
        await role(other);
        assert.equal(
          (
            await pg.query(
              "select * from storage.objects where bucket_id='health-documents'",
            )
          ).rows.length,
          1,
        );
        await role();
        await pg.exec("set role service_role");
        await assert.rejects(
          pg.query("select * from service_provider_organization_profiles"),
          /permission denied/,
        );
        await assert.rejects(
          val("select bp_profile($1) v", [location]),
          /permission denied/,
        );
        await assert.rejects(
          val("select save_service_provider_organization_profile($1,$2) v", [
            org,
            { name: "Spoof" },
          ]),
          /permission denied/,
        );
        await role(owner);
        await assert.rejects(
          val("select bp_profile($1) v", [location]),
          /permission denied/,
        );
      },
    );
    await t.test(
      "only owner/admin can edit; no direct browser writes",
      async () => {
        for (const id of [owner, admin]) {
          await role(id);
          await save();
        }
        for (const id of [staff, manager, other]) {
          await role(id);
          await assert.rejects(save(), /Not authorized/);
        }
        await role(staff);
        assert.equal(
          (
            await val<ProfileEditor>(
              "select service_provider_profile_editor($1) v",
              [org],
            )
          ).canEdit,
          false,
        );
        await role(other);
        await assert.rejects(
          val("select service_provider_profile_editor($1) v", [org]),
          /Not authorized/,
        );
        await role(owner);
        await assert.rejects(
          val("select save_service_provider_location_profile($1,$2,$3) v", [
            org,
            foreignLocation,
            {},
          ]),
          /Location unavailable/,
        );
        for (const table of [
          "service_provider_organization_profiles",
          "service_provider_location_profiles",
          "service_provider_services",
          "service_provider_location_hours",
          "service_provider_assets",
        ])
          await assert.rejects(
            pg.query("select * from " + table),
            /permission denied/,
          );
      },
    );
    await t.test(
      "contact validation, safe text and provider-owned data",
      async () => {
        await role(owner);
        for (const url of [
          "javascript:alert(1)",
          "data:text/html,x",
          "https://user:secret@host.com",
          "https://host.com\\evil",
        ])
          await assert.rejects(save({ website_url: url }));
        for (const url of ["http://example.com", "https://example.com/path"])
          await save({ website_url: url });
        for (const x of [
          { public_email: "bad" },
          { public_phone: "<script>" },
          { description: "x".repeat(3001) },
          { tagline: "x".repeat(161) },
          { name: "" },
          { google_name: "Google" },
        ])
          await assert.rejects(save(x));
        await save({
          description: "<script>plain text</script>",
          public_email: "public@example.com",
          public_phone: "+1 (704) 555-1234",
          website_url: "https://provider.example",
        });
        await assert.rejects(
          val("select save_service_provider_location_profile($1,$2,$3) v", [
            org,
            location,
            { time_zone: "invented/timezone" },
          ]),
        );
        await val("select save_service_provider_location_profile($1,$2,$3) v", [
          org,
          location,
          {
            display_name: "Uptown",
            address_line1: "Provider-entered address",
            time_zone: "America/New_York",
          },
        ]);
        assert.equal(await pub(), null);
        await publish();
        const p = await pub();
        assert.equal(p.businessName, "Independent provider name");
        assert.equal(p.address.line1, "Provider-entered address");
        assert.equal(p.publicPhone, "+1 (704) 555-1234");
        assert.doesNotMatch(
          JSON.stringify(p),
          /requested_by|reviewer_note|claim_note|object_path|uploaded_by|membership|credential/,
        );
      },
    );
    await t.test(
      "hours: explicit unknown/closed, windows, overlap, 24h and bounds",
      async () => {
        await role(owner);
        const hours = (h: unknown[], provided = true) =>
          val("select replace_service_provider_location_hours($1,$2,$3,$4) v", [
            org,
            location,
            h,
            provided,
          ]);
        const win = (a = "09:00", b = "12:00", slot = 1) => ({
          day_of_week: 1,
          slot,
          opens_at: a,
          closes_at: b,
          is_24_hours: false,
        });
        await hours([]);
        assert.equal((await pub()).hoursProvided, true);
        await hours([], false);
        assert.equal((await pub()).hoursProvided, false);
        await hours([win(), win("13:00", "17:00", 2)]);
        assert.equal((await pub()).hours.length, 2);
        for (const h of [
          [win(), win("11:00", "14:00", 2)],
          [win(), win()],
          [win("09:00", "09:00")],
          [win("22:00", "06:00")],
          [{ ...win(), day_of_week: 7 }],
          [{ ...win(), slot: 3 }],
          Array(15).fill(win()),
          [
            { day_of_week: 1, slot: 1, is_24_hours: true },
            win("13:00", "17:00", 2),
          ],
        ])
          await assert.rejects(hours(h));
        await hours([{ day_of_week: 0, slot: 1, is_24_hours: true }]);
        assert.equal((await pub()).hours[0].is_24_hours, true);
      },
    );
    await t.test(
      "services: create/edit/archive, limits and veterinary label gives no authority",
      async () => {
        await role(owner);
        const add = (
          data: Record<string, unknown> = {},
          id: string | null = null,
        ) =>
          val<string>("select save_service_provider_service($1,$2,$3,$4) v", [
            org,
            location,
            id,
            {
              category: "veterinary",
              name: "Annual exams",
              display_order: 1,
              ...data,
            },
          ]);
        const id = await add();
        await add({ name: "Provider-entered exams" }, id);
        assert.equal((await pub()).services[0].name, "Provider-entered exams");
        await assert.rejects(add({ category: "verifier" }));
        await assert.rejects(add({ display_order: 1001 }));
        for (let i = 1; i < 50; i++) await add({ name: "Service " + i });
        await assert.rejects(add(), /Maximum 50/);
        await val("select archive_service_provider_service($1,$2,$3) v", [
          org,
          location,
          id,
        ]);
        assert.equal((await pub()).services.length, 49);
        await role();
        for (const table of [
          "veterinary_providers",
          "provider_memberships",
          "provider_connections",
        ])
          assert.equal(
            await val<number>("select count(*)::integer v from " + table),
            0,
          );
        await role(owner);
        await assert.rejects(
          pg.query("insert into provider_memberships default values"),
        );
      },
    );
    await t.test(
      "draft/unpublished/suspended data unavailable; identity immutable",
      async () => {
        await role(owner);
        await publish("unpublished");
        await role();
        await pg.exec("set role anon");
        assert.equal(await pub(), null);
        await assert.rejects(
          val("select service_provider_profile_editor($1) v", [org]),
        );
        await role(owner);
        await publish();
        await role();
        await pg.exec("set role anon");
        assert.ok(await pub());
        await role();
        await pg.query(
          "update service_provider_locations set status='suspended' where id=$1",
          [location],
        );
        await role(owner);
        assert.equal(await pub(), null);
        await assert.rejects(publish(), /Location unavailable/);
        await role();
        await pg.query(
          "update service_provider_locations set status='active' where id=$1",
          [location],
        );
        await pg.query(
          "update service_provider_organizations set status='suspended' where id=$1",
          [org],
        );
        await role(owner);
        assert.equal(await pub(), null);
        await assert.rejects(save(), /Business unavailable/);
        await role();
        await pg.query(
          "update service_provider_organizations set status='active' where id=$1",
          [org],
        );
        await assert.rejects(
          pg.query(
            "update service_provider_location_profiles set location_id=$1 where location_id=$2",
            [foreignLocation, location],
          ),
          /immutable/,
        );
      },
    );
    await t.test("logo prepare/finalize and public/draft access", async () => {
      const prepare = (name = "logo.png", mime = "image/png", size = 8) =>
        val<{ id: string; path: string }>(
          "select prepare_service_provider_logo($1,$2,$3,$4) v",
          [org, name, mime, size],
        );
      await role(staff);
      await assert.rejects(prepare(), /Not authorized/);
      await role(other);
      await assert.rejects(prepare(), /Not authorized/);
      await role(owner);
      for (const args of [
        ["logo.svg", "image/svg+xml", 8],
        ["logo.jpg", "image/png", 8],
        ["logo.png", "image/png", 3145729],
      ] as const)
        await assert.rejects(prepare(args[0], args[1], args[2]));
      const invalid = await prepare();
      await pg.query(
        "insert into storage.objects(bucket_id,name,metadata) values('provider-profile-assets',$1,$2)",
        [invalid.path, { size: 99, mimetype: "image/jpeg" }],
      );
      await assert.rejects(
        val("select finalize_service_provider_logo($1,$2) v", [
          org,
          invalid.id,
        ]),
        /missing or invalid/,
      );
      const a = await prepare();
      await assert.rejects(
        val("select finalize_service_provider_logo($1,$2) v", [org, a.id]),
        /missing or invalid/,
      );
      await pg.query(
        "insert into storage.objects(bucket_id,name,metadata) values('provider-profile-assets',$1,$2)",
        [a.path, { size: 8, mimetype: "image/png" }],
      );
      await val("select finalize_service_provider_logo($1,$2) v", [org, a.id]);
      await val("select finalize_service_provider_logo($1,$2) v", [org, a.id]);
      assert.doesNotMatch(JSON.stringify(await pub()), /logos\//);
      await publish("unpublished");
      await role();
      await pg.exec("set role anon");
      assert.equal(
        await val("select service_provider_logo_delivery($1) v", [location]),
        null,
      );
      assert.equal(
        (await pg.query("select * from storage.objects")).rows.length,
        0,
      );
      await role(staff);
      assert.ok(
        await val("select service_provider_logo_delivery(null,$1) v", [org]),
      );
      await role(other);
      assert.equal(
        await val("select service_provider_logo_delivery(null,$1) v", [org]),
        null,
      );
      await role(owner);
      await publish();
      await role();
      await pg.exec("set role anon");
      assert.ok(
        await val("select service_provider_logo_delivery($1) v", [location]),
      );
      assert.equal(
        (
          await pg.query(
            "select * from storage.objects where bucket_id='provider-profile-assets'",
          )
        ).rows.length,
        1,
      );
      await role(owner);
      const b = await prepare("new.webp", "image/webp", 12);
      await pg.query(
        "insert into storage.objects(bucket_id,name,metadata) values('provider-profile-assets',$1,$2)",
        [b.path, { size: 12, mimetype: "image/webp" }],
      );
      await val("select finalize_service_provider_logo($1,$2) v", [org, b.id]);
      await role();
      assert.equal(
        await val("select status v from service_provider_assets where id=$1", [
          a.id,
        ]),
        "retired",
      );
      await assert.rejects(
        pg.query(
          "insert into service_provider_organization_profiles(logo_asset_id,organization_id) values($1,$2)",
          [b.id, foreignOrg],
        ),
      );
      await role(other);
      assert.equal(
        (
          await pg.query(
            "delete from storage.objects where bucket_id='provider-profile-assets' and name=$1 returning id",
            [a.path],
          )
        ).rows.length,
        0,
      );
      await role(owner);
      assert.equal(
        (
          await pg.query(
            "delete from storage.objects where bucket_id='provider-profile-assets' and name=$1 returning id",
            [a.path],
          )
        ).rows.length,
        1,
      );
      assert.equal(
        (
          await pg.query(
            "delete from storage.objects where bucket_id='provider-profile-assets' and name=$1 returning id",
            [b.path],
          )
        ).rows.length,
        0,
      );
      await role(owner);
      const expired = await prepare();
      await role();
      await pg.exec(
        "alter table service_provider_assets disable trigger service_provider_assets_guard",
      );
      await pg.query(
        "update service_provider_assets set created_at=now()-interval '2 hours' where id=$1",
        [expired.id],
      );
      await pg.exec(
        "alter table service_provider_assets enable trigger service_provider_assets_guard",
      );
      await role(owner);
      await assert.rejects(
        val("select finalize_service_provider_logo($1,$2) v", [
          org,
          expired.id,
        ]),
        /expired/,
      );
      await prepare();
      await role();
      assert.equal(
        await val("select status v from service_provider_assets where id=$1", [
          expired.id,
        ]),
        "retired",
      );
    });
    await t.test(
      "organization profile ownership and raw paths cannot be reassigned",
      async () => {
        await role();
        await assert.rejects(
          pg.query(
            "update service_provider_organization_profiles set organization_id=$1 where organization_id=$2",
            [foreignOrg, org],
          ),
          /immutable/,
        );
        await role(owner);
        await assert.rejects(
          val("select save_service_provider_organization_profile($1,$2) v", [
            org,
            { name: "Business", logo_asset_id: randomUUID() },
          ]),
          /Invalid profile fields/,
        );
        await assert.rejects(
          val("select save_service_provider_location_profile($1,$2,$3) v", [
            org,
            location,
            { google_place_id: "ChIJ-spoof" },
          ]),
          /Invalid profile fields/,
        );
      },
    );
    await t.test(
      "publication revocation stops public logo delivery and cross-org paths stay protected",
      async () => {
        await role(owner);
        await publish();
        const delivery = await val<{ key: string }>(
          "select service_provider_logo_delivery($1) v",
          [location],
        );
        await role(other);
        await assert.rejects(
          pg.query(
            "insert into storage.objects(bucket_id,name,metadata) values('provider-profile-assets',$1,'{}')",
            ["logos/" + randomUUID()],
          ),
        );
        await assert.rejects(
          val("select finalize_service_provider_logo($1,$2) v", [
            foreignOrg,
            delivery.key,
          ]),
          /Logo unavailable/,
        );
        await role();
        await pg.query(
          "update service_provider_locations set status='suspended' where id=$1",
          [location],
        );
        await role();
        await pg.exec("set role anon");
        assert.equal(
          await val("select service_provider_logo_delivery($1) v", [location]),
          null,
        );
        assert.equal(
          (
            await pg.query(
              "select * from storage.objects where bucket_id='provider-profile-assets'",
            )
          ).rows.length,
          0,
        );
        await role();
        await pg.query(
          "update service_provider_locations set status='active' where id=$1",
          [location],
        );
      },
    );
  } finally {
    await pg.close();
  }
});
