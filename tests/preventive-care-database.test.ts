import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { PreventiveCare } from "../lib/preventive-care/schema";
test("Preventive care private read model and content governance", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }),
    owner = randomUUID(),
    foreign = randomUUID(),
    business = randomUUID();
  const value = async <T = string>(sql: string, args: unknown[] = []) =>
    (await pg.query<{ v: T }>(sql, args)).rows[0]?.v;
  const role = async (user?: string, dbRole?: string) => {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || "",
    ]);
    if (user || dbRole)
      await pg.exec("set role " + (dbRole || "authenticated"));
  };
  try {
    await pg.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
    );
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));

    for (const id of [owner, foreign, business])
      await pg.query("insert into auth.users values($1,$2,now())", [
        id,
        id + "@example.com",
      ]);
    const organization = await value(
      "insert into service_provider_organizations(name) values('Business') returning id v",
    );
    await pg.query(
      "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'owner')",
      [organization, business],
    );
    await role(owner);
    const hh = await value(
      "insert into households(name) values('Home') returning id v",
    );
    const pet = await value(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jaxson','Dog','Mixed','Male') returning id v",
      [hh],
    );
    const care = () =>
      value<PreventiveCare>(
        "select my_pet_preventive_care($1,'America/New_York') v",
        [pet],
      );
    await t.test(
      "Dog guidance remains guidance with traceable source and no invented dates",
      async () => {
        const d = await care();
        assert.equal(d.guidance.length, 4);
        assert.deepEqual(d.needsAttention, []);
        for (const g of d.guidance) {
          assert.equal(g.trustLevel, "guidance");
          assert.equal(g.sourceType, "pawport_guidance");
          assert.equal(g.date, null);
          assert.ok(g.source.url.startsWith("https://www.aaha.org/"));
          assert.ok(g.contentReviewedAt);
          assert.match(g.id, /guidance:dog_/);
        }
      },
    );
    await t.test(
      "Anonymous, other owners and unrelated business users cannot access or write private data",
      async () => {
        for (const id of [foreign, business]) {
          await role(id);
          await assert.rejects(care());
          await assert.rejects(
            pg.query("select save_pet_preventive_profile($1,$2)", [pet, "{}"]),
          );
          await assert.rejects(
            pg.query(
              "select set_preventive_guidance_state($1,'dog_dental','discussed')",
              [pet],
            ),
          );
        }
        await role(undefined, "anon");
        await assert.rejects(care());
        await role(owner);
        for (const table of [
          "preventive_guidance_sources",
          "preventive_guidance_rules",
          "pet_preventive_guidance_states",
          "pet_preventive_profiles",
        ]) {
          await assert.rejects(pg.query("select * from " + table));
          await assert.rejects(pg.query("delete from " + table));
        }
      },
    );
    await t.test(
      "Explicit record dates retain owner provenance; name/admin date alone never creates a due date",
      async () => {
        await role(owner);
        await pg.query(
          "insert into vaccinations(pet_id,name,administered_on,due_on,clinic) values($1,'Rabies',current_date-500,current_date-1,'Owner clinic'),($1,'No due date',current_date-300,null,'Owner clinic'),($1,'Future date',current_date-1,current_date+12,'Owner clinic')",
          [pet],
        );
        const d = await care();
        assert.equal(d.needsAttention.length, 1);
        assert.equal(d.needsAttention[0].sourceType, "owner_entered");
        assert.equal(d.needsAttention[0].trustLevel, "owner");
        assert.equal(d.upcoming.length, 1);
        assert.equal(d.records[0].date, null);
        assert.equal(d.records[0].status, "date_not_recorded");
        assert.ok(!d.needsAttention.some((i) => i.itemType === "guidance"));
      },
    );
    await t.test(
      "Owner lifestyle is controlled, private and cannot generate record facts",
      async () => {
        const before = await care();
        await pg.query("select save_pet_preventive_profile($1,$2)", [
          pet,
          JSON.stringify({
            indoor_outdoor: "outdoor",
            wildlife_exposure: true,
            owner_notes: "Private note",
          }),
        ]);
        const profile = await value<{ owner_notes: string }>(
          "select my_pet_preventive_profile($1) v",
          [pet],
        );
        assert.equal(profile.owner_notes, "Private note");
        assert.deepEqual((await care()).needsAttention, before.needsAttention);
        assert.deepEqual((await care()).guidance, before.guidance);
        assert.ok(!JSON.stringify(await care()).includes("Private note"));
        for (const data of [
          { owner_notes: "x".repeat(501) },
          { indoor_outdoor: "guess" },
          { user_id: foreign },
          { wildlife_exposure: "true" },
        ])
          await assert.rejects(
            pg.query("select save_pet_preventive_profile($1,$2)", [
              pet,
              JSON.stringify(data),
            ]),
          );
      },
    );
    await t.test(
      "Snooze is bounded; dismissed/discussed state never escalates trust",
      async () => {
        await pg.query(
          "select set_preventive_guidance_state($1,'dog_dental','snoozed',current_date+7)",
          [pet],
        );
        assert.equal((await care()).guidance.length, 3);
        await assert.rejects(
          pg.query(
            "select set_preventive_guidance_state($1,'dog_dental','snoozed',current_date+100)",
            [pet],
          ),
        );
        await role();
        await pg.query(
          "update pet_preventive_guidance_states set snoozed_until=current_date-1 where pet_id=$1",
          [pet],
        );
        await role(owner);
        assert.equal((await care()).guidance.length, 4);
        await pg.query(
          "select set_preventive_guidance_state($1,'dog_dental','discussed')",
          [pet],
        );
        const d = await care();
        assert.equal(d.guidance.length, 3);
        const g = d.savedGuidance.find((g) => g.ruleKey === "dog_dental")!;
        assert.equal(g.status, "discussed");
        assert.equal(g.trustLevel, "guidance");
        await pg.query(
          "select set_preventive_guidance_state($1,'dog_wellness','not_relevant')",
          [pet],
        );
        assert.equal((await care()).guidance.length, 2);
      },
    );
    await t.test(
      "Version governance, hidden preferences and inactive rules",
      async () => {
        await role();
        await assert.rejects(
          pg.query(
            "update preventive_guidance_rules set title='Changed' where rule_key='dog_dental'",
          ),
          /new version/,
        );
        await pg.query(
          "update preventive_guidance_rules set title='Dental discussion',version=2 where rule_key='dog_dental'",
        );
        await role(owner);
        const g = (await care()).savedGuidance.find(
          (g) => g.ruleKey === "dog_dental",
        )!;
        assert.equal(g.ruleVersion, 2);
        assert.equal(g.stateVersion, 1);
        assert.equal(g.status, "discussed");
        await role();
        await pg.query(
          "update preventive_guidance_rules set active=false where rule_key='dog_parasite_prevention'",
        );
        await role(owner);
        assert.equal((await care()).guidance.length, 1);
        await role();
        await pg.query("update preventive_guidance_sources set active=false");
        await role(owner);
        assert.equal((await care()).guidance.length, 0);
        await role();
        await pg.query("update preventive_guidance_sources set active=true");
        await role(owner);
      },
    );
    await t.test(
      "Unsupported species and missing birthdate never trigger age assumptions",
      async () => {
        await role(owner);
        for (const species of ["Cat", "Other"]) {
          await pg.query("update pets set species=$1 where id=$2", [
            species,
            pet,
          ]);
          const d = await care();
          assert.equal(d.guidance.length, species === "Cat" ? 4 : 0);
          assert.equal(d.needsAttention.length, 1);
        }
        await pg.query("update pets set species='Dog' where id=$1", [pet]);
      },
    );
    await t.test(
      "Document and veterinary provenance remain distinct; no document-inferred date",
      async () => {
        await role();
        const ids: string[] = [];
        for (const name of ["Document record", "Verified record"])
          ids.push(
            await value(
              "insert into vaccinations(pet_id,name,administered_on,clinic) values($1,$2,current_date-10,'Clinic') returning id v",
              [pet, name],
            ),
          );
        const doc = await value(
          "insert into health_documents(pet_id,uploaded_by,original_name,object_path,mime_type,byte_size,uploaded_at) values($1,$2,'Record.pdf','PRIVATE_PREVENTIVE_PATH','application/pdf',10,now()) returning id v",
          [pet, owner],
        );
        await pg.query(
          "insert into vaccination_documents(vaccination_id,document_id,attached_by) values($1,$2,$3)",
          [ids[0], doc, owner],
        );
        const provider = await value(
          "insert into veterinary_providers(name) values('Vet') returning id v",
        );
        await pg.query(
          "insert into provider_memberships(provider_id,user_id) values($1,$2)",
          [provider, business],
        );
        await pg.query(
          "insert into verification_requests(vaccination_id,provider_id,requested_by,status,verified_at,verified_by,provider_name) values($1,$2,$3,'verified',now(),$3,'Vet')",
          [ids[1], provider, owner],
        );
        await role(business);
        await assert.rejects(care());
        await assert.rejects(
          pg.query("select my_pet_preventive_profile($1)", [pet]),
        );
        await role(owner);
        const records = (await care()).records;
        assert.equal(
          records.find((r) => r.title === "Document record vaccination record")!
            .sourceType,
          "document_supported",
        );
        assert.equal(
          records.find((r) => r.title === "Document record vaccination record")!
            .trustLevel,
          "supported",
        );
        assert.equal(
          records.find((r) => r.title === "Verified record vaccination record")!
            .sourceType,
          "vet_verified",
        );
        assert.equal(
          records.find((r) => r.title === "Verified record vaccination record")!
            .date,
          null,
        );
        assert.ok(
          !JSON.stringify(await care()).includes("PRIVATE_PREVENTIVE_PATH"),
        );
      },
    );
    await t.test(
      "Appointments and owner routines retain their source labels; paused/cancelled data excluded",
      async () => {
        await role(owner);
        const plan = await value("select save_care_plan(null,$1,$2) v", [
          pet,
          JSON.stringify({
            title: "Owner routine",
            category: "custom",
            instructions: "",
            recurrence_type: "one_time",
            interval_value: null,
            interval_unit: null,
            time_zone: "UTC",
            anchor_local_date: new Date(Date.now() + 86400000)
              .toISOString()
              .slice(0, 10),
            anchor_local_time: "",
            ends_on: "",
            reminders: [],
          }),
        ]);
        await role();
        await pg.query(
          "insert into appointments(household_id,pet_id,created_by,source,title,appointment_type,starts_at,time_zone,status) values($1,$2,$3,'manual','Future visit','other',now()+interval '2 days','America/New_York','scheduled'),($1,$2,$3,'manual','Cancelled visit','other',now()+interval '2 days','UTC','cancelled')",
          [hh, pet, owner],
        );
        await role(owner);
        let d = await care();
        assert.equal(d.routines[0].sourceType, "care_plan");
        assert.equal(d.routines[0].trustLevel, "owner");
        assert.equal(
          d.upcoming.find((i) => i.itemType === "appointment")!.sourceLabel,
          "Scheduled appointment",
        );
        assert.ok(!d.upcoming.some((i) => i.title === "Cancelled visit"));
        assert.ok(d.needsAttention.every((i) => i.itemType === "record"));
        await role();
        await pg.query("update care_plans set status='paused' where id=$1", [
          plan,
        ]);
        await role(owner);
        d = await care();
        assert.equal(d.routines.length, 0);
      },
    );
    await t.test(
      "Share-pass public JSON excludes private lifestyle and discussion preferences",
      async () => {
        await role(owner);
        const token = await value<{ token: string }>(
          "select create_share_pass($1,1) v",
          [pet],
        );
        await role(undefined, "anon");
        const shared = await value("select read_share_pass($1) v", [
          token.token,
        ]);
        assert.ok(shared);
        for (const forbidden of [
          "Private note",
          "guidance",
          "snoozed",
          "indoor_outdoor",
          "preventive",
        ])
          assert.ok(!JSON.stringify(shared).includes(forbidden));
        await role(owner);
      },
    );
    await t.test(
      "Invalid timezone rejected and profile/state identity cannot be moved",
      async () => {
        await role(owner);
        await assert.rejects(
          pg.query("select my_pet_preventive_care($1,'bad/zone')", [pet]),
        );
        await role();
        await assert.rejects(
          pg.query("update pet_preventive_guidance_states set user_id=$1", [
            foreign,
          ]),
        );
        await assert.rejects(
          pg.query("update pet_preventive_profiles set updated_by=$1", [
            foreign,
          ]),
        );
      },
    );
    await t.test(
      "Date-only attention uses the owner timezone rather than UTC",
      async () => {
        await role();
        const id = await value(
          "insert into vaccinations(pet_id,name,administered_on,due_on,clinic) values($1,'Boundary',current_date-1,(now() at time zone 'Pacific/Kiritimati')::date,'Clinic') returning id v",
          [pet],
        );
        await role(owner);
        const east = await value<PreventiveCare>(
          "select my_pet_preventive_care($1,'Pacific/Kiritimati') v",
          [pet],
        );
        const west = await value<PreventiveCare>(
          "select my_pet_preventive_care($1,'Pacific/Honolulu') v",
          [pet],
        );
        assert.ok(
          east.needsAttention.some((i) => i.id === "vaccination:" + id),
        );
        assert.ok(west.upcoming.some((i) => i.id === "vaccination:" + id));
      },
    );
    await t.test("Life-stage rules fail closed even when active", async () => {
      await role();
      await pg.query(
        "insert into preventive_guidance_rules(rule_key,source_id,species,category,title,summary,discussion_prompt,life_stage) select 'dog_stage_test',id,'dog','wellness','Stage topic','General topic','Discuss this topic','senior' from preventive_guidance_sources limit 1",
      );
      await role(owner);
      assert.ok(
        !(await care()).savedGuidance.some(
          (g) => g.ruleKey === "dog_stage_test",
        ),
      );
    });
  } finally {
    await pg.close();
  }
});
