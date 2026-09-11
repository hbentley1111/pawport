import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

test("Phase 3 preserves existing data and enforces multi-pet isolation in PostgreSQL", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const a = randomUUID(),
    b = randomUUID(),
    vet = randomUUID(),
    provider = randomUUID();
  async function admin() {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub','',false)");
  }
  async function asUser(id: string | null) {
    await admin();
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    await pg.exec(id ? "set role authenticated" : "set role anon");
  }
  async function value<T = string>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  async function denied(sql: string, args: unknown[] = []) {
    await assert.rejects(() => pg.query(sql, args));
  }
  async function pet(home: string, name: string) {
    return value(
      "insert into public.pets(household_id,name,species,breed,sex) values($1,$2,'Dog','Mixed','Unknown') returning id as result",
      [home, name],
    );
  }
  async function vaccine(petId: string, name: string) {
    return value(
      "insert into public.vaccinations(pet_id,name,administered_on,clinic) values($1,$2,'2025-01-01','Clinic') returning id as result",
      [petId, name],
    );
  }
  async function document(petId: string) {
    const d = await value<{ id: string; path: string }>(
      "select public.prepare_health_document($1,'visit.pdf','application/pdf',10) as result",
      [petId],
    );
    await pg.query(
      "insert into storage.objects(bucket_id,name,metadata) values('health-documents',$1,$2)",
      [d.path, { size: 10, mimetype: "application/pdf" }],
    );
    await pg.query("select public.finalize_health_document($1)", [d.id]);
    return d;
  }
  async function photo(petId: string) {
    return value<{ id: string; path: string }>(
      "select public.prepare_pet_photo($1,'face.JPG','image/jpeg',10) as result",
      [petId],
    );
  }
  async function upload(path: string) {
    await pg.query(
      "insert into storage.objects(bucket_id,name,metadata) values('pet-photos',$1,$2)",
      [path, { size: 10, mimetype: "image/jpeg" }],
    );
  }
  try {
    await pg.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth,storage,public to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
      alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to anon,authenticated;`);
    for (const name of [
      "202609110001_passport.sql",
      "202609110002_verified_records.sql",
    ])
      await pg.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await pg.query("insert into auth.users values($1),($2),($3)", [a, b, vet]);
    await pg.query(
      "insert into public.veterinary_providers(id,name) values($1,'Verified clinic')",
      [provider],
    );
    await pg.query(
      "insert into public.provider_memberships values($1,$2,true)",
      [provider, vet],
    );
    await asUser(a);
    const home = await value(
      "insert into public.households(name) values('A family') returning id as result",
    );
    const first = await pet(home, "Original Milo");
    const firstVacc = await vaccine(first, "Milo rabies");
    const oldPass = await value<{ id: string; token: string }>(
      "select public.create_share_pass($1,24) as result",
      [first],
    );
    const originalDoc = await document(first);
    await pg.query("select public.attach_vaccination_document($1,$2)", [
      firstVacc,
      originalDoc.id,
    ]);
    const originalRequest = await value(
      "select public.request_vaccination_verification($1,$2) as result",
      [firstVacc, provider],
    );
    await asUser(vet);
    await pg.query(
      "select public.complete_vaccination_verification($1,'Private verification note')",
      [originalRequest],
    );
    await asUser(b);
    const otherHome = await value(
      "insert into public.households(name) values('B family') returning id as result",
    );
    const otherPet = await pet(otherHome, "Private B pet");
    await admin();
    const tables = [
      "pets",
      "vaccinations",
      "share_passes",
      "health_documents",
      "vaccination_documents",
      "vaccination_provenance",
      "verification_requests",
      "health_audit_events",
    ];
    const before = new Map<string, unknown[]>();
    for (const table of tables)
      before.set(
        table,
        (
          await pg.query(
            `select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`,
          )
        ).rows,
      );
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110003_multi_pet_profiles.sql",
        "utf8",
      ),
    );
    await t.test(
      "existing pet IDs, documents, attestations, audits and share tokens survive unchanged; FK remains",
      async () => {
        for (const table of tables) {
          const projection =
            table === "pets" ? "to_jsonb(t)-'photo_id'" : "to_jsonb(t)";
          assert.deepEqual(
            (
              await pg.query(
                `select ${projection} as row from public.${table} t order by (${projection})::text`,
              )
            ).rows,
            before.get(table),
          );
        }
        assert.equal(
          await value<number>(
            "select count(*)::int as result from pg_constraint where conrelid='public.pets'::regclass and contype='f' and confrelid='public.households'::regclass",
          ),
          1,
        );
        await asUser(null);
        const shared = await value<{
          pet: { name: string };
          vaccinations: { verification_status: string }[];
        }>("select public.read_share_pass($1) as result", [oldPass.token]);
        assert.equal(shared.pet.name, "Original Milo");
        assert.equal(
          shared.vaccinations[0].verification_status,
          "provider_verified",
        );
      },
    );
    let second: string,
      third: string,
      secondVacc: string,
      secondDoc: { id: string; path: string };
    await t.test(
      "owner adds second and third pets and can edit only allowlisted profile fields",
      async () => {
        await asUser(a);
        second = await pet(home, "Luna second");
        third = await pet(home, "Olive third");
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.pets where household_id=$1",
            [home],
          ),
          3,
        );
        await pg.query(
          "update public.pets set name='Luna',species='Cat',breed='Domestic',birth_date='2022-01-01',sex='Female',microchip='ABC-123' where id=$1",
          [second],
        );
        assert.equal(
          await value("select breed as result from public.pets where id=$1", [
            second,
          ]),
          "Domestic",
        );
        for (const sql of [
          "update public.pets set household_id=$1 where id=$2",
          "update public.pets set id=$1 where id=$2",
          "update public.pets set photo_id=$1 where id=$2",
        ])
          await denied(sql, [otherHome, second]);
        await denied("delete from public.pets where id=$1", [second]);
        // Trigger also guards ownership if an operator later grants broader SQL updates.
        await admin();
        await denied("update public.pets set household_id=$1 where id=$2", [
          otherHome,
          second,
        ]);
        await asUser(a);
      },
    );
    await t.test(
      "cross-household pet read, creation and editing fail",
      async () => {
        assert.equal(
          (await pg.query("select * from public.pets where id=$1", [otherPet]))
            .rows.length,
          0,
        );
        await denied(
          "insert into public.pets(household_id,name,species,breed,sex) values($1,'Forged','Dog','Mixed','Unknown')",
          [otherHome],
        );
        assert.equal(
          (
            await pg.query(
              "update public.pets set name='Forged' where id=$1 returning id",
              [otherPet],
            )
          ).rows.length,
          0,
        );
        await asUser(b);
        assert.equal(
          await value("select name as result from public.pets where id=$1", [
            otherPet,
          ]),
          "Private B pet",
        );
        assert.equal(
          (
            await pg.query("select * from public.pets where household_id=$1", [
              home,
            ])
          ).rows.length,
          0,
        );
        await asUser(a);
      },
    );
    await t.test(
      "vaccinations, documents, trust and verification requests stay selected-pet specific",
      async () => {
        secondVacc = await vaccine(second, "Luna vaccine");
        secondDoc = await document(second);
        assert.deepEqual(
          (
            await pg.query(
              "select name from public.vaccinations where pet_id=$1",
              [first],
            )
          ).rows,
          [{ name: "Milo rabies" }],
        );
        assert.deepEqual(
          (
            await pg.query(
              "select id from public.health_documents where pet_id=$1",
              [second],
            )
          ).rows,
          [{ id: secondDoc.id }],
        );
        await denied("select public.attach_vaccination_document($1,$2)", [
          secondVacc,
          originalDoc.id,
        ]);
        await pg.query("select public.attach_vaccination_document($1,$2)", [
          secondVacc,
          secondDoc.id,
        ]);
        const trust = await value<
          { vaccination_id: string; request_id: string | null }[]
        >("select public.owner_vaccination_trust($1) as result", [second]);
        assert.equal(trust.length, 1);
        assert.equal(trust[0].vaccination_id, secondVacc);
        assert.equal(trust[0].request_id, null);
        assert.deepEqual(
          await value("select public.owner_vaccination_trust($1) as result", [
            third,
          ]),
          [],
        );
        await asUser(b);
        assert.deepEqual(
          await value("select public.owner_vaccination_trust($1) as result", [
            first,
          ]),
          [],
        );
      },
    );
    await t.test(
      "provider sees only the submitted record and document, never other pets or photos",
      async () => {
        await asUser(a);
        await pg.query("select public.close_vaccination_verification($1)", [
          await value(
            "select public.request_vaccination_verification($1,$2) as result",
            [secondVacc, provider],
          ),
        ]);
        // Revoke original attestation as provider, then resubmit only first pet.
        await asUser(vet);
        await pg.query("select public.close_vaccination_verification($1)", [
          originalRequest,
        ]);
        await asUser(a);
        const request = await value(
          "select public.request_vaccination_verification($1,$2) as result",
          [firstVacc, provider],
        );
        await asUser(vet);
        const queue = await value<{ pet_name: string; document_id: string }[]>(
          "select public.provider_verification_queue() as result",
        );
        assert.equal(queue.length, 1);
        assert.equal(queue[0].pet_name, "Original Milo");
        assert.equal(queue[0].document_id, originalDoc.id);
        for (const table of [
          "pets",
          "households",
          "vaccinations",
          "verification_requests",
          "pet_photo_uploads",
        ])
          assert.equal(
            (await pg.query(`select * from public.${table}`)).rows.length,
            0,
          );
        assert.deepEqual(
          (await pg.query("select id from public.health_documents")).rows,
          [{ id: originalDoc.id }],
        );
        assert.equal(
          (
            await pg.query("select * from storage.objects where name=$1", [
              secondDoc.path,
            ])
          ).rows.length,
          0,
        );
        await denied(
          "select public.prepare_pet_photo($1,'x.jpg','image/jpeg',10)",
          [second],
        );
        await pg.query(
          "select public.complete_vaccination_verification($1,'Confirmed')",
          [request],
        );
        assert.equal(
          (await pg.query("select * from public.health_documents")).rows.length,
          0,
        );
      },
    );
    await t.test(
      "old Pet A share pass never leaks Pet B data; other pet passes revoke independently",
      async () => {
        await asUser(a);
        const secondPass = await value<{ id: string; token: string }>(
          "select public.create_share_pass($1,24) as result",
          [second],
        );
        await pg.query("select public.revoke_share_pass($1)", [secondPass.id]);
        await asUser(null);
        const shared = await value<{
          pet: { name: string };
          vaccinations: { name: string; verification_status: string }[];
        }>("select public.read_share_pass($1) as result", [oldPass.token]);
        assert.equal(shared.pet.name, "Original Milo");
        assert.equal(shared.vaccinations.length, 1);
        assert.equal(shared.vaccinations[0].name, "Milo rabies");
        assert.equal(
          shared.vaccinations[0].verification_status,
          "provider_verified",
        );
        for (const hidden of [
          "Luna",
          "Olive",
          secondDoc.id,
          "Private verification note",
          "photo_id",
          home,
          second,
        ])
          assert.equal(JSON.stringify(shared).includes(hidden), false);
        assert.equal(
          await value("select public.read_share_pass($1) as result", [
            secondPass.token,
          ]),
          null,
        );
      },
    );
    await t.test(
      "private photo policies resist cross-household, anonymous and unrelated broad Storage policies",
      async () => {
        await admin();
        await pg.exec(`create policy unrelated_read on storage.objects for select to public using(true);
      create policy unrelated_insert on storage.objects for insert to public with check(true);
      create policy unrelated_update on storage.objects for update to public using(true) with check(true);
      create policy unrelated_delete on storage.objects for delete to public using(true);`);
        const bucket = (
          await pg.query<{
            public: boolean;
            file_size_limit: number;
            allowed_mime_types: string[];
          }>(
            "select public,file_size_limit,allowed_mime_types from storage.buckets where id='pet-photos'",
          )
        ).rows[0];
        assert.equal(bucket.public, false);
        assert.equal(Number(bucket.file_size_limit), 3145728);
        assert.deepEqual(bucket.allowed_mime_types, [
          "image/jpeg",
          "image/png",
        ]);
        await asUser(a);
        const reservation = await photo(first);
        assert.ok(reservation.path.startsWith(`${home}/${first}/`));
        await denied("select public.finalize_pet_photo($1)", [reservation.id]);
        for (const user of [b, vet, null]) {
          await asUser(user);
          await denied(
            "select public.prepare_pet_photo($1,'face.jpg','image/jpeg',10)",
            [first],
          );
          await assert.rejects(() => upload(reservation.path));
          await denied("select public.finalize_pet_photo($1)", [
            reservation.id,
          ]);
        }
        await asUser(a);
        await upload(reservation.path);
        await pg.query("select public.finalize_pet_photo($1)", [
          reservation.id,
        ]);
        await denied("update public.pets set photo_id=$1 where id=$2", [
          reservation.id,
          second,
        ]);
        await denied(
          "insert into public.pets(household_id,name,species,breed,sex,photo_id) values($1,'Pointer spoof','Dog','Mixed','Unknown',$2)",
          [home, reservation.id],
        );
        for (const user of [b, vet, null]) {
          await asUser(user);
          for (const sql of [
            "select * from storage.objects where bucket_id='pet-photos' and name=$1",
            "delete from storage.objects where bucket_id='pet-photos' and name=$1 returning id",
          ]) {
            // Existing Phase 2 restrictive policies may deny anonymous SQL before row filtering.
            try {
              assert.equal(
                (await pg.query(sql, [reservation.path])).rows.length,
                0,
              );
            } catch (error) {
              assert.equal((error as { code?: string }).code, "42501");
            }
          }
        }
        await asUser(a);
        assert.equal(
          (
            await pg.query(
              "update storage.objects set metadata='{}' where name=$1 returning id",
              [reservation.path],
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await pg.query(
              "delete from storage.objects where name=$1 returning id",
              [reservation.path],
            )
          ).rows.length,
          0,
        );
        const replacement = await photo(first);
        await upload(replacement.path);
        const done = await value<{ previous_path: string }>(
          "select public.finalize_pet_photo($1) as result",
          [replacement.id],
        );
        assert.equal(done.previous_path, reservation.path);
        assert.equal(
          await value(
            "select photo_id as result from public.pets where id=$1",
            [first],
          ),
          replacement.id,
        );
        assert.equal(
          (
            await pg.query(
              "delete from storage.objects where name=$1 returning id",
              [reservation.path],
            )
          ).rows.length,
          1,
        );
        await denied("select public.finalize_pet_photo($1)", [reservation.id]);
        assert.equal(
          await value(
            "select photo_id as result from public.pets where id=$1",
            [second],
          ),
          null,
        );
        // Retry is idempotent and cannot retire the current photo.
        assert.deepEqual(
          await value("select public.finalize_pet_photo($1) as result", [
            replacement.id,
          ]),
          { previous_path: null },
        );
      },
    );
    await t.test(
      "database rejects invalid photo files, arbitrary paths, metadata mismatch and expired reservations",
      async () => {
        await asUser(a);
        for (const [name, mime, size] of [
          ["face.svg", "image/svg+xml", 10],
          ["face.pdf", "application/pdf", 10],
          ["face.png", "image/jpeg", 10],
          ["../face.jpg", "image/jpeg", 10],
          ["noextension", "image/jpeg", 10],
          ["face.jpg", "image/jpeg", 0],
          ["face.jpg", "image/jpeg", 3145729],
        ])
          await denied("select public.prepare_pet_photo($1,$2,$3,$4)", [
            second,
            name,
            mime,
            size,
          ]);
        await assert.rejects(() =>
          upload(`${home}/${second}/${randomUUID()}.jpg`),
        );
        const wrong = await photo(second);
        await pg.query(
          "insert into storage.objects(bucket_id,name,metadata) values('pet-photos',$1,$2)",
          [wrong.path, { size: 11, mimetype: "image/jpeg" }],
        );
        await denied("select public.finalize_pet_photo($1)", [wrong.id]);
        const expired = await photo(second);
        await admin();
        await pg.query(
          "update public.pet_photo_uploads set created_at=now()-interval '2 hours' where id=$1",
          [expired.id],
        );
        await asUser(a);
        await assert.rejects(() => upload(expired.path));
        await denied("select public.finalize_pet_photo($1)", [expired.id]);
      },
    );
    await t.test(
      "database enforces 20-pet limit on bulk/direct writes without preventing profile edits",
      async () => {
        await asUser(a);
        await pg.query(
          "insert into public.pets(household_id,name,species,breed,sex) select $1,'Companion '||n,'Dog','Mixed','Unknown' from generate_series(4,20) n",
          [home],
        );
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.pets where household_id=$1",
            [home],
          ),
          20,
        );
        await assert.rejects(() => pet(home, "Twenty one"));
        await pg.query(
          "update public.pets set breed='Updated at limit' where id=$1",
          [third],
        );
        assert.equal(
          await value("select breed as result from public.pets where id=$1", [
            third,
          ]),
          "Updated at limit",
        );
        await asUser(b);
        await pet(otherHome, "B second");
      },
    );
  } finally {
    await pg.close();
  }
});
