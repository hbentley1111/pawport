import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { TimelinePage } from "../lib/timeline/schema";
test("Private pet timeline: PostgreSQL journal, authoritative sources, photos and pagination", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }),
    a = randomUUID(),
    b = randomUUID();
  async function role(id?: string) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    if (id) await pg.exec("set role authenticated");
  }
  async function val<T = string>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  let pet: string, pet2: string, foreign: string, ha: string, hb: string;
  const data = (x: Record<string, unknown> = {}) => ({
    entry_type: "note",
    title: "A day together",
    note: "A private memory",
    occurred_at: "2020-09-11T12:00:00Z",
    time_zone: "America/New_York",
    weight_value: null,
    weight_unit: null,
    photo_id: null,
    ...x,
  });
  const save = (
    x: Record<string, unknown> = {},
    id: string | null = null,
    p = pet,
  ) =>
    val("select save_pet_journal_entry($1,$2,$3) as result", [id, p, data(x)]);
  const timeline = (
    filter = "all",
    limit = 25,
    cursor: TimelinePage["nextCursor"] = null,
    p = pet,
  ) =>
    val<TimelinePage>("select my_pet_timeline($1,$2,$3,$4,$5) as result", [
      p,
      filter,
      cursor?.at || null,
      cursor?.id || null,
      limit,
    ]);
  async function photo(p = pet, journal = true) {
    const prepared = await val<{ id: string; path: string }>(
      "select prepare_pet_photo($1,'photo.jpg','image/jpeg',3) as result",
      [p],
    );
    await pg.query(
      "insert into storage.objects(bucket_id,name,metadata) values('pet-photos',$1,$2)",
      [prepared.path, { size: 3, mimetype: "image/jpeg" }],
    );
    await pg.query(
      `select ${journal ? "finalize_journal_photo" : "finalize_pet_photo"}($1)`,
      [prepared.id],
    );
    return prepared;
  }
  try {
    await pg.exec(
      `create role anon;create role authenticated;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
    );
    for (const f of [
      "001_passport",
      "002_verified_records",
      "003_multi_pet_profiles",
      "004_local_services_reviews",
      "005_care_calendar",
      "006_scheduling_connections",
      "007_smart_openings",
      "008_care_plans",
    ])
      await pg.exec(
        await readFile(`supabase/migrations/202609110${f}.sql`, "utf8"),
      );
    const before = (
      await pg.query(
        "select * from pg_policies order by schemaname,tablename,policyname",
      )
    ).rows;
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110009_pet_timeline.sql",
        "utf8",
      ),
    );
    assert.deepEqual(
      (
        await pg.query(
          "select * from pg_policies order by schemaname,tablename,policyname",
        )
      ).rows,
      before,
    );
    await pg.query("insert into auth.users(id) values($1),($2)", [a, b]);
    await role(a);
    ha = await val(
      "insert into households(name) values('A') returning id as result",
    );
    pet = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jaxson','Dog','Mixed','Male') returning id as result",
      [ha],
    );
    pet2 = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jasper','Dog','Mixed','Male') returning id as result",
      [ha],
    );
    await role(b);
    hb = await val(
      "insert into households(name) values('B') returning id as result",
    );
    foreign = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Ellie','Dog','Mixed','Female') returning id as result",
      [hb],
    );
    await role(a);
    await t.test(
      "owner CRUD, identity immutability, cross-household and anonymous denial",
      async () => {
        const id = await save();
        assert.ok((await timeline()).events.some((e) => e.sourceId === id));
        await save({ title: "Changed moment" }, id);
        assert.equal(
          (await timeline()).events.find((e) => e.sourceId === id)!.title,
          "Changed moment",
        );
        await assert.rejects(save({}, null, foreign));
        await assert.rejects(save({ household_id: hb }));
        await assert.rejects(save({ created_by: b }));
        await assert.rejects(save({ entry_type: "vaccination" }));
        await assert.rejects(save({ entry_type: "milestone" }, id));
        await assert.rejects(pg.exec("select * from pet_journal_entries"));
        await assert.rejects(
          pg.exec("insert into pet_journal_entries default values"),
        );
        await role();
        await assert.rejects(
          pg.query("update pet_journal_entries set pet_id=$1 where id=$2", [
            pet2,
            id,
          ]),
        );
        await assert.rejects(
          pg.query(
            "update pet_journal_entries set household_id=$1,pet_id=$2,created_by=$3 where id=$4",
            [hb, foreign, b, id],
          ),
        );
        await pg.exec("set role anon");
        await assert.rejects(timeline());
        await assert.rejects(pg.exec("select * from pet_journal_entries"));
        await role(b);
        await assert.rejects(timeline());
        await assert.rejects(
          pg.query("select delete_pet_journal_entry($1)", [id]),
        );
        assert.equal(
          await val("select my_pet_journal_entry($1,$2) as result", [pet, id]),
          null,
        );
        await role(a);
        await pg.query("select delete_pet_journal_entry($1)", [id]);
        await pg.query("select delete_pet_journal_entry($1)", [id]);
        assert.ok(!(await timeline()).events.some((e) => e.sourceId === id));
      },
    );
    await t.test(
      "backdated notes, milestone, activity, custom and bounded weight storage",
      async () => {
        for (const type of ["note", "milestone", "activity", "custom"]) {
          const id = await save({ entry_type: type });
          assert.equal(
            (await timeline("life")).events.find((e) => e.sourceId === id)!
              .eventType,
            `journal_${type}`,
          );
        }
        for (const unit of ["lb", "kg"]) {
          const id = await save({
            entry_type: "weight",
            title: "",
            weight_value: 68.2,
            weight_unit: unit,
          });
          const event = (await timeline("life")).events.find(
            (e) => e.sourceId === id,
          )!;
          assert.equal(event.metadata.weightValue, 68.2);
          assert.equal(event.metadata.weightUnit, unit);
          assert.equal(event.trustState, null);
        }
        for (const x of [
          { weight_value: -1 },
          { weight_value: 0 },
          { weight_value: 1000 },
          { weight_unit: "oz" },
          { weight_value: null },
          { weight_value: 1.0001 },
          { weight_value: 454, weight_unit: "kg" },
        ])
          await assert.rejects(
            save({
              entry_type: "weight",
              weight_value: 1,
              weight_unit: "lb",
              ...x,
            }),
          );
        for (const x of [
          { title: "x".repeat(121) },
          { note: "x".repeat(2001) },
          { occurred_at: "1899-01-01T00:00Z" },
          { occurred_at: "infinity" },
          { occurred_at: "2199-01-01T00:00Z" },
          { time_zone: "Wrong/Zone" },
          { entry_type: "milestone", title: "" },
          { title: "", note: "" },
        ])
          await assert.rejects(save(x));
      },
    );
    await t.test(
      "same-pet private journal photos, foreign photo denial, profile replacement retention and missing files",
      async () => {
        const current = await photo(pet, false),
          own = await photo(),
          other = await photo(pet2);
        await role(b);
        const outside = await photo(foreign);
        await role(a);
        await assert.rejects(save({ entry_type: "photo", photo_id: other.id }));
        await assert.rejects(
          save({ entry_type: "photo", photo_id: outside.id }),
        );
        const id = await save({
          entry_type: "photo",
          photo_id: own.id,
          title: "Beach weekend",
        });
        const pinned = await save({
          entry_type: "photo",
          photo_id: current.id,
        });
        assert.equal(
          await val("select photo_id as result from pets where id=$1", [pet]),
          current.id,
        );
        await photo(pet, false);
        assert.equal(
          await val<boolean>(
            "select can_access_pet_photo($1,'delete') as result",
            [current.path],
          ),
          false,
        );
        assert.equal(
          (
            await pg.query("select id from storage.objects where name=$1", [
              current.path,
            ])
          ).rows.length,
          1,
        );
        await assert.rejects(
          pg
            .query("delete from storage.objects where name=$1 returning id", [
              current.path,
            ])
            .then((r) => {
              if (r.rows.length === 0) throw Error("Denied as expected");
            }),
        );
        const e = (await timeline("life", 50)).events.find(
          (e) => e.sourceId === id,
        )!;
        assert.equal(
          e.photoUrl,
          `/pets/${pet}/timeline/${id}/photo?v=${own.id}`,
        );
        assert.ok(!JSON.stringify(e).includes(own.path));
        assert.equal(e.trustState, null);
        // Simulate an operator/storage outage: owners can still edit/delete their memory and UI offers a photo fallback.
        await role();
        await pg.query("delete from storage.objects where name=$1", [own.path]);
        await role(a);
        await save(
          { entry_type: "photo", photo_id: own.id, title: "Photo unavailable" },
          id,
        );
        await pg.query("select delete_pet_journal_entry($1)", [id]);
        await pg.query("select delete_pet_journal_entry($1)", [pinned]);
        assert.equal(
          await val<boolean>(
            "select can_access_pet_photo($1,'delete') as result",
            [current.path],
          ),
          true,
        );
      },
    );
    await t.test(
      "authoritative care snapshots, completed/cancelled appointments, trust states and safe document events",
      async () => {
        const plan = await val("select save_care_plan(null,$1,$2) as result", [
          pet,
          {
            title: "Original care",
            category: "custom",
            instructions: "",
            recurrence_type: "interval",
            interval_value: 1,
            interval_unit: "day",
            time_zone: "UTC",
            anchor_local_date: "2020-01-01",
            anchor_local_time: "",
            ends_on: "",
            reminders: [],
          },
        ]);
        const occurrence = async () => {
          const p = await val<{ occurrence: { id: string } }[]>(
            "select my_care_plans(null,$1) as result",
            [plan],
          );
          return p[0].occurrence.id;
        };
        await pg.query("select complete_care_occurrence($1)", [
          await occurrence(),
        ]);
        await pg.query("select skip_care_occurrence($1)", [await occurrence()]);
        await role();
        await pg.query(
          "update care_plans set title='Renamed care' where id=$1",
          [plan],
        );
        await pg.query(
          "update care_plan_occurrences set status='cancelled' where plan_id=$1 and status='pending'",
          [plan],
        );
        for (const status of ["completed", "cancelled"])
          await pg.query(
            "insert into appointments(household_id,pet_id,created_by,source,title,appointment_type,starts_at,status,time_zone) values($1,$2,$3,'manual','Annual visit','veterinary','2020-09-11T11:00Z',$4,'UTC')",
            [ha, pet, a, status],
          );
        const vaccinationIds: string[] = [];
        for (let n = 0; n < 4; n++)
          vaccinationIds.push(
            await val(
              "insert into vaccinations(pet_id,name,administered_on,clinic) values($1,$2,'2020-09-11','Clinic') returning id as result",
              [pet, `Vaccine ${n}`],
            ),
          );
        const doc = await val(
          "insert into health_documents(pet_id,uploaded_by,original_name,object_path,mime_type,byte_size,uploaded_at) values($1,$2,'Annual exam.pdf','PRIVATE_STORAGE_PATH','application/pdf',10,now()) returning id as result",
          [pet, a],
        );
        await pg.query(
          "insert into vaccination_documents(vaccination_id,document_id,attached_by) values($1,$2,$3)",
          [vaccinationIds[1], doc, a],
        );
        const provider = await val(
          "insert into veterinary_providers(name) values('Verified provider') returning id as result",
        );
        await pg.query(
          "insert into verification_requests(vaccination_id,provider_id,requested_by,status,verified_at,verified_by,provider_name,notes) values($1,$2,$3,'verified',now(),$3,'Verified provider','PRIVATE_VERIFICATION_NOTES')",
          [vaccinationIds[2], provider, a],
        );
        await pg.query(
          "insert into verification_requests(vaccination_id,provider_id,requested_by,status) values($1,$2,$3,'pending')",
          [vaccinationIds[3], provider, a],
        );
        await role(a);
        const care = await timeline("care");
        assert.equal(care.events.length, 2);
        assert.ok(
          care.events.every((e) => e.title.startsWith("Original care")),
        );
        assert.deepEqual(
          new Set(care.events.map((e) => e.eventType)),
          new Set(["care_completed", "care_skipped"]),
        );
        const appointments = await timeline("appointments");
        assert.deepEqual(
          new Set(appointments.events.map((e) => e.eventType)),
          new Set(["appointment_completed", "appointment_cancelled"]),
        );
        const health = await timeline("health");
        for (const [n, trust] of [
          "owner_entered",
          "document_supported",
          "vet_verified",
          "owner_entered",
        ].entries())
          assert.equal(
            health.events.find((e) => e.sourceId === vaccinationIds[n])!
              .trustState,
            trust,
          );
        assert.equal(
          health.events.find((e) => e.sourceId === vaccinationIds[3])!
            .eventType,
          "verification_requested",
        );
        assert.equal(
          health.events.filter((e) => e.sourceId === vaccinationIds[2]).length,
          1,
        );
        assert.ok(
          health.events.some(
            (e) =>
              e.sourceType === "document" &&
              e.actionUrl === `/documents/${doc}`,
          ),
        );
        await role();
        await pg.query(
          "update verification_requests set status='revoked',revoked_at=now() where vaccination_id=$1",
          [vaccinationIds[2]],
        );
        await role(a);
        const revoked = (await timeline("health")).events.find(
          (e) => e.sourceId === vaccinationIds[2],
        )!;
        assert.equal(revoked.eventType, "verification_revoked");
        assert.equal(revoked.trustState, "owner_entered");
        assert.equal(revoked.id, `vaccination:${vaccinationIds[2]}`);
        const json = JSON.stringify((await timeline("all", 50)).events);
        for (const privateValue of [
          ha,
          a,
          provider,
          "PRIVATE_STORAGE_PATH",
          "PRIVATE_VERIFICATION_NOTES",
          "household_id",
          "created_by",
          "object_path",
          "external_appointment_id",
          "connection_id",
        ])
          assert.ok(!json.includes(privateValue), privateValue);
        await assert.rejects(save({}, vaccinationIds[0]));
        await assert.rejects(
          pg.query("select delete_pet_journal_entry($1)", [vaccinationIds[0]]),
        );
        assert.equal(
          (
            await pg.query("select id from vaccinations where id=$1", [
              vaccinationIds[0],
            ])
          ).rows.length,
          1,
        );
      },
    );
    await t.test(
      "stable IDs, total order, equal timestamps, cursor pagination and filter/page bounds",
      async () => {
        for (let i = 0; i < 8; i++) await save({ title: `Same instant ${i}` });
        const all = await timeline("life", 50);
        let cursor: TimelinePage["nextCursor"] = null;
        const ids: string[] = [];
        do {
          const page = await timeline("life", 3, cursor);
          ids.push(...page.events.map((e) => e.id));
          cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(
          ids,
          all.events.map((e) => e.id),
        );
        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual(
          (await timeline("life", 50)).events.map((e) => e.id),
          ids,
        );
        for (let i = 1; i < all.events.length; i++) {
          const prev = all.events[i - 1],
            next = all.events[i];
          assert.ok(Date.parse(prev.occurredAt) >= Date.parse(next.occurredAt));
          if (prev.occurredAt === next.occurredAt) assert.ok(prev.id > next.id);
        }
        await assert.rejects(timeline("all", 51));
        await assert.rejects(timeline("all", 0));
        await assert.rejects(timeline("arbitrary"));
        await assert.rejects(
          pg.query("select my_pet_timeline($1,'all',now(),null,25)", [pet]),
        );
        assert.equal((await timeline("all", 25, null, pet2)).events.length, 0);
      },
    );
  } finally {
    await pg.close();
  }
});
