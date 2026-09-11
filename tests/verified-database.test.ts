import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
// Real PostgreSQL migrations, functions and RLS. Minimal auth/storage schema fixtures
// model Supabase contracts; this is not a substitute for the hosted Storage HTTP test.
test("additive migration and PostgreSQL trust authorization", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const a = randomUUID(),
    b = randomUUID(),
    vet = randomUUID(),
    outsider = randomUUID(),
    provider = randomUUID();
  async function admin() {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub','',false)");
  }
  async function asUser(id: string | null) {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id || "",
    ]);
    await pg.exec(id ? "set role authenticated" : "set role anon");
  }
  async function value<T>(sql: string, args: unknown[] = []) {
    return (await pg.query<{ result: T }>(sql, args)).rows[0]?.result;
  }
  async function denied(sql: string, args: unknown[] = []) {
    await assert.rejects(() => pg.query(sql, args));
  }
  try {
    await pg.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,storage,public to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to anon,authenticated;`);
    await pg.exec(
      await readFile("supabase/migrations/202609110001_passport.sql", "utf8"),
    );
    await pg.query("insert into auth.users(id) values($1),($2),($3),($4)", [
      a,
      b,
      vet,
      outsider,
    ]);
    await asUser(a);
    const household = await value<string>(
      "insert into public.households(name) values('A') returning id as result",
    );
    const pet = await value<string>(
      "insert into public.pets(household_id,name,species,breed,sex) values($1,'Milo','Dog','Mixed','Male') returning id as result",
      [household],
    );
    const vaccination = await value<string>(
      "insert into public.vaccinations(pet_id,name,administered_on,due_on,clinic) values($1,'Rabies','2025-01-01','2027-01-01','Owner typed clinic') returning id as result",
      [pet],
    );
    const oldPass = await value<{ id: string; token: string }>(
      "select public.create_share_pass($1,24) as result",
      [pet],
    );
    await admin();
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110002_verified_records.sql",
        "utf8",
      ),
    );
    await pg.query(
      "insert into public.veterinary_providers(id,name) values($1,'South End Veterinary Clinic')",
      [provider],
    );
    await pg.query(
      "insert into public.provider_memberships(provider_id,user_id) values($1,$2)",
      [provider, vet],
    );
    await t.test(
      "migration preserves historical records and pre-existing share tokens",
      async () => {
        await asUser(a);
        assert.equal(
          await value(
            "select source as result from public.vaccination_provenance where vaccination_id=$1",
            [vaccination],
          ),
          "owner_entered",
        );
        await asUser(null);
        const shared = await value<{
          vaccinations: Array<{ name: string; verification_status: string }>;
        }>("select public.read_share_pass($1) as result", [oldPass.token]);
        assert.equal(shared.vaccinations[0].name, "Rabies");
        assert.equal(
          shared.vaccinations[0].verification_status,
          "owner_entered",
        );
      },
    );
    let document: { id: string; path: string };
    let secondVaccination: string;
    let request: string;
    await t.test(
      "owners can still create vaccinations and cannot forge provenance or verification",
      async () => {
        await asUser(a);
        secondVaccination = await value<string>(
          "insert into public.vaccinations(pet_id,name,administered_on,clinic) values($1,'DHPP','2025-01-01','Clinic') returning id as result",
          [pet],
        );
        assert.equal(
          await value(
            "select count(*)::int as result from public.health_audit_events where event_type='vaccination_created'",
          ),
          1,
        );
        await denied(
          "insert into public.provider_memberships(provider_id,user_id) values($1,$2)",
          [provider, a],
        );
        await denied(
          "insert into public.veterinary_providers(name) values('Fake clinic')",
        );
        await denied(
          "insert into public.verification_requests(vaccination_id,provider_id,status) values($1,$2,'verified')",
          [vaccination, provider],
        );
        await denied(
          "update public.vaccination_provenance set entered_by=$1 where vaccination_id=$2",
          [vet, vaccination],
        );
      },
    );
    await t.test(
      "private document reservation validates ownership, extension, MIME and size",
      async () => {
        await asUser(b);
        await denied(
          "select public.prepare_health_document($1,'visit.pdf','application/pdf',10)",
          [pet],
        );
        assert.equal(
          (await pg.query("select * from public.vaccinations")).rows.length,
          0,
        );
        await asUser(a);
        for (const [name, mime, size] of [
          ["bad.pdf", "image/png", 10],
          ["../visit.pdf", "application/pdf", 10],
          ["visit.pdf", "application/pdf", 3145729],
        ])
          await denied("select public.prepare_health_document($1,$2,$3,$4)", [
            pet,
            name,
            mime,
            size,
          ]);
        document = await value(
          "select public.prepare_health_document($1,$2,$3,$4) as result",
          [pet, "visit.pdf", "application/pdf", 10],
        );
        await denied("select public.finalize_health_document($1)", [
          document.id,
        ]);
        await asUser(b);
        assert.equal(
          (await pg.query("select * from public.health_documents")).rows.length,
          0,
        );
        await denied(
          "insert into storage.objects(bucket_id,name,metadata) values('health-documents',$1,$2)",
          [document.path, { size: 10, mimetype: "application/pdf" }],
        );
        await asUser(a);
        await pg.query(
          "insert into storage.objects(bucket_id,name,metadata) values('health-documents',$1,$2)",
          [document.path, { size: 10, mimetype: "application/pdf" }],
        );
        await pg.query("select public.finalize_health_document($1)", [
          document.id,
        ]);
        await pg.query("select public.attach_vaccination_document($1,$2)", [
          vaccination,
          document.id,
        ]);
        const trust = await value<Array<{ verification_status: string }>>(
          "select public.owner_vaccination_trust($1) as result",
          [pet],
        );
        assert.equal(trust[0].verification_status, "document_supported");
      },
    );
    await t.test(
      "storage guards deny cross-tenant and anonymous reads, replacement and deletion even with broad policies",
      async () => {
        await admin();
        await pg.exec(
          "create policy unrelated_broad_policy on storage.objects for all to public using(true) with check(true)",
        );
        await asUser(b);
        assert.equal(
          (
            await pg.query(
              "select * from storage.objects where bucket_id='health-documents'",
            )
          ).rows.length,
          0,
        );
        await asUser(null);
        await assert.rejects(() =>
          pg.query("select * from public.health_documents"),
        );
        // Depending on planner evaluation an anonymous helper denial may error or filter rows.
        try {
          assert.equal(
            (
              await pg.query(
                "select * from storage.objects where bucket_id='health-documents'",
              )
            ).rows.length,
            0,
          );
        } catch (e) {
          assert.match(String(e), /permission denied/);
        }
        await asUser(a);
        assert.equal(
          (await pg.query("select * from storage.objects")).rows.length,
          1,
        );
        assert.equal(
          (
            await pg.query(
              "update storage.objects set name='replaced' returning id",
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (await pg.query("delete from storage.objects returning id")).rows
            .length,
          0,
        );
      },
    );
    await t.test(
      "provider gets only presented record; owner and unauthorized provider cannot verify",
      async () => {
        await asUser(vet);
        assert.deepEqual(
          await value("select public.provider_verification_queue() as result"),
          [],
        );
        assert.equal(
          (await pg.query("select * from public.vaccinations")).rows.length,
          0,
        );
        await asUser(a);
        request = await value(
          "select public.request_vaccination_verification($1,$2) as result",
          [vaccination, provider],
        );
        await denied("select public.complete_vaccination_verification($1,$2)", [
          request,
          "Owner spoof",
        ]);
        await asUser(outsider);
        await denied("select public.complete_vaccination_verification($1,$2)", [
          request,
          "Unauthorized",
        ]);
        await asUser(vet);
        const queue = await value<Array<Record<string, unknown>>>(
          "select public.provider_verification_queue() as result",
        );
        assert.equal(queue.length, 1);
        assert.equal(queue[0].document_id, document.id);
        assert.equal(queue[0].pet_name, "Milo");
        for (const field of [
          "household_id",
          "microchip",
          "owner_id",
          "requested_by",
          "pet_id",
        ])
          assert.equal(field in queue[0], false);
        assert.equal(
          (await pg.query("select * from public.pets")).rows.length,
          0,
        );
        assert.equal(
          (await pg.query("select * from public.vaccinations")).rows.length,
          0,
        );
        assert.equal(
          (await pg.query("select * from public.health_documents")).rows.length,
          1,
        );
        await asUser(a);
        await denied("select public.attach_vaccination_document($1,$2)", [
          vaccination,
          document.id,
        ]);
        await admin();
        await pg.query(
          "insert into public.provider_memberships(provider_id,user_id) values($1,$2)",
          [provider, a],
        );
        await asUser(a);
        await denied("select public.complete_vaccination_verification($1,$2)", [
          request,
          "Even an owner who is a vet cannot self-verify",
        ]);
      },
    );
    await t.test(
      "authorized verification succeeds with attributable audit and minimal public trust fields",
      async () => {
        await asUser(vet);
        await pg.query("select public.log_health_document_access($1)", [
          document.id,
        ]);
        await pg.query(
          "select public.complete_vaccination_verification($1,$2)",
          [request, "Private clinical note"],
        );
        assert.equal(
          (await pg.query("select * from public.health_documents")).rows.length,
          0,
        );
        await asUser(a);
        const r = (
          await pg.query<{ verified_by: string; verified_at: string }>(
            "select verified_by,verified_at from public.verification_requests where id=$1",
            [request],
          )
        ).rows[0];
        assert.equal(r.verified_by, vet);
        assert.ok(r.verified_at);
        assert.equal(
          await value(
            "select count(*)::int as result from public.health_audit_events where event_type='verification_completed'",
          ),
          1,
        );
        await asUser(null);
        const shared = await value<{
          vaccinations: Array<Record<string, unknown>>;
        }>("select public.read_share_pass($1) as result", [oldPass.token]);
        const v = shared.vaccinations.find((v) => v.name === "Rabies")!;
        assert.equal(v.verification_status, "provider_verified");
        assert.equal(v.verified_by, "South End Veterinary Clinic");
        assert.ok(v.verified_at);
        assert.deepEqual(Object.keys(v).sort(), [
          "administered_on",
          "clinic",
          "due_on",
          "name",
          "source",
          "verification_status",
          "verified_at",
          "verified_by",
        ]);
        assert.equal(
          JSON.stringify(shared).includes("Private clinical note"),
          false,
        );
      },
    );
    await t.test(
      "revocation removes trust, blocks former member, and preserves share revocation",
      async () => {
        await asUser(a);
        await denied("select public.close_vaccination_verification($1)", [
          request,
        ]);
        await admin();
        await pg.query(
          "update public.provider_memberships set active=false where user_id=$1",
          [vet],
        );
        await asUser(vet);
        await denied("select public.close_vaccination_verification($1)", [
          request,
        ]);
        await admin();
        await pg.query(
          "update public.provider_memberships set active=true where user_id=$1",
          [vet],
        );
        await asUser(vet);
        await pg.query("select public.close_vaccination_verification($1)", [
          request,
        ]);
        await asUser(null);
        const shared = await value<{
          vaccinations: Array<{
            name: string;
            verification_status: string;
            verified_by: unknown;
          }>;
        }>("select public.read_share_pass($1) as result", [oldPass.token]);
        assert.equal(
          shared.vaccinations.find((v) => v.name === "Rabies")
            ?.verification_status,
          "document_supported",
        );
        assert.equal(
          shared.vaccinations.find((v) => v.name === "Rabies")?.verified_by,
          null,
        );
        await asUser(a);
        await pg.query("select public.revoke_share_pass($1)", [oldPass.id]);
        await asUser(null);
        assert.equal(
          await value("select public.read_share_pass($1) as result", [
            oldPass.token,
          ]),
          null,
        );
      },
    );
    await t.test(
      "owner cancellation immediately withdraws submitted document access",
      async () => {
        await asUser(a);
        const pending = await value<string>(
          "select public.request_vaccination_verification($1,$2) as result",
          [vaccination, provider],
        );
        await asUser(vet);
        assert.equal(
          (await pg.query("select * from public.health_documents")).rows.length,
          1,
        );
        await asUser(a);
        await pg.query("select public.close_vaccination_verification($1)", [
          pending,
        ]);
        await asUser(vet);
        assert.deepEqual(
          await value("select public.provider_verification_queue() as result"),
          [],
        );
        await denied("select public.complete_vaccination_verification($1,$2)", [
          pending,
          "late",
        ]);
      },
    );
    await t.test(
      "cross-household evidence cannot be attached and providers cannot browse unrelated documents",
      async () => {
        await asUser(b);
        const bh = await value<string>(
          "insert into public.households(name) values('B') returning id as result",
        );
        const bp = await value<string>(
          "insert into public.pets(household_id,name,species,breed,sex) values($1,'Luna','Cat','Mixed','Female') returning id as result",
          [bh],
        );
        const bd = await value<{ id: string; path: string }>(
          "select public.prepare_health_document($1,'b.pdf','application/pdf',10) as result",
          [bp],
        );
        await pg.query(
          "insert into storage.objects(bucket_id,name,metadata) values('health-documents',$1,$2)",
          [bd.path, { size: 10, mimetype: "application/pdf" }],
        );
        await pg.query("select public.finalize_health_document($1)", [bd.id]);
        await asUser(a);
        assert.equal(
          (
            await pg.query(
              "select * from public.health_documents where id=$1",
              [bd.id],
            )
          ).rows.length,
          0,
        );
        await denied("select public.attach_vaccination_document($1,$2)", [
          secondVaccination,
          bd.id,
        ]);
        const unrelated = await value<{ id: string; path: string }>(
          "select public.prepare_health_document($1,'unrelated.pdf','application/pdf',10) as result",
          [pet],
        );
        await pg.query(
          "insert into storage.objects(bucket_id,name,metadata) values('health-documents',$1,$2)",
          [unrelated.path, { size: 10, mimetype: "application/pdf" }],
        );
        await pg.query("select public.finalize_health_document($1)", [
          unrelated.id,
        ]);
        await pg.query(
          "select public.request_vaccination_verification($1,$2)",
          [vaccination, provider],
        );
        await asUser(vet);
        assert.equal(
          (await pg.query("select * from public.health_documents")).rows.length,
          1,
        );
        assert.equal(
          (
            await pg.query(
              "select * from public.health_documents where id=$1",
              [unrelated.id],
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await pg.query(
              "select * from public.health_documents where id=$1",
              [bd.id],
            )
          ).rows.length,
          0,
        );
      },
    );
    await t.test(
      "expired share passes remain inaccessible after the additive migration",
      async () => {
        await asUser(a);
        const pass = await value<{ id: string; token: string }>(
          "select public.create_share_pass($1,1) as result",
          [pet],
        );
        await admin();
        await pg.query(
          "update public.share_passes set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",
          [pass.id],
        );
        await asUser(null);
        assert.equal(
          await value("select public.read_share_pass($1) as result", [
            pass.token,
          ]),
          null,
        );
      },
    );
    await t.test(
      "verifier and audit identity references survive Auth account deletion",
      async () => {
        await admin();
        await pg.query("delete from auth.users where id=$1", [vet]);
        assert.equal(
          await value(
            "select verified_by as result from public.verification_requests where id=$1",
            [request],
          ),
          vet,
        );
        assert.equal(
          await value(
            "select actor_id as result from public.health_audit_events where request_id=$1 and event_type='verification_completed'",
            [request],
          ),
          vet,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
