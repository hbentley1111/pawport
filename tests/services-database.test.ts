import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("Phase 4 community privacy, ownership, moderation, and Phase 1–3 isolation", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } }),
    a = randomUUID(),
    b = randomUUID(),
    vet = randomUUID();
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
  const place = "ChIJ-community-place",
    otherPlace = "another-place";
  let reviewA: string, reviewB: string;
  try {
    await pg.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
   create table auth.users(id uuid primary key,email text);
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
   alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
    for (const name of [
      "202609110001_passport.sql",
      "202609110002_verified_records.sql",
      "202609110003_multi_pet_profiles.sql",
    ])
      await pg.exec(await readFile(`supabase/migrations/${name}`, "utf8"));
    await pg.query(
      "insert into auth.users values($1,'private-a@example.com'),($2,'private-b@example.com'),($3,'private-vet@example.com')",
      [a, b, vet],
    );
    await asUser(a);
    const household = await value(
      "insert into public.households(name) values('Private family') returning id as result",
    );
    const pet = await value(
      "insert into public.pets(household_id,name,species,breed,sex) values($1,'Private Milo','Dog','Mixed','Male') returning id as result",
      [household],
    );
    const secondPet = await value(
      "insert into public.pets(household_id,name,species,breed,sex) values($1,'Private Luna','Cat','Mixed','Female') returning id as result",
      [household],
    );
    const vaccination = await value(
      "insert into public.vaccinations(pet_id,name,administered_on,clinic) values($1,'Rabies','2025-01-01','Clinic') returning id as result",
      [pet],
    );
    const pass = await value<{ id: string; token: string }>(
      "select public.create_share_pass($1,24) as result",
      [pet],
    );
    const doc = await value<{ id: string; path: string }>(
      "select public.prepare_health_document($1,'visit.pdf','application/pdf',10) as result",
      [pet],
    );
    await pg.query(
      "insert into storage.objects(bucket_id,name,metadata) values('health-documents',$1,$2)",
      [doc.path, { size: 10, mimetype: "application/pdf" }],
    );
    await pg.query("select public.finalize_health_document($1)", [doc.id]);
    await pg.query("select public.attach_vaccination_document($1,$2)", [
      vaccination,
      doc.id,
    ]);
    await admin();
    const provider = await value(
      "insert into public.veterinary_providers(name) values('Verified clinic') returning id as result",
    );
    await pg.query(
      "insert into public.provider_memberships values($1,$2,true)",
      [provider, vet],
    );
    await asUser(a);
    const request = await value(
      "select public.request_vaccination_verification($1,$2) as result",
      [vaccination, provider],
    );
    await asUser(vet);
    await pg.query(
      "select public.complete_vaccination_verification($1,'Private note')",
      [request],
    );
    await admin();
    const policies = (
      await pg.query(
        "select * from pg_policies order by schemaname,tablename,policyname",
      )
    ).rows;
    const oldTables = [
      "households",
      "pets",
      "vaccinations",
      "share_passes",
      "health_documents",
      "verification_requests",
      "health_audit_events",
      "pet_photo_uploads",
    ];
    const before = new Map<string, unknown[]>();
    for (const table of oldTables)
      before.set(
        table,
        (
          await pg.query(
            `select to_jsonb(t) from public.${table} t order by to_jsonb(t)::text`,
          )
        ).rows,
      );
    await pg.exec(
      await readFile(
        "supabase/migrations/202609110004_local_services_reviews.sql",
        "utf8",
      ),
    );
    await t.test(
      "additive migration preserves medical rows and every existing RLS/Storage policy",
      async () => {
        for (const table of oldTables)
          assert.deepEqual(
            (
              await pg.query(
                `select to_jsonb(t) from public.${table} t order by to_jsonb(t)::text`,
              )
            ).rows,
            before.get(table),
          );
        assert.deepEqual(
          (
            await pg.query(
              "select * from pg_policies where tablename not in ('service_reviews','service_favorites','user_service_preferences','service_review_reports') order by schemaname,tablename,policyname",
            )
          ).rows,
          policies,
        );
        await asUser(a);
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.pets",
          ),
          2,
        );
        await asUser(b);
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.pets",
          ),
          0,
        );
        await asUser(vet);
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.pets",
          ),
          0,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.health_documents",
          ),
          0,
        );
        await asUser(null);
        const shared = await value<{
          pet: { name: string };
          vaccinations: { verification_status: string }[];
        }>("select public.read_share_pass($1) as result", [pass.token]);
        assert.equal(shared.pet.name, "Private Milo");
        assert.equal(
          shared.vaccinations[0].verification_status,
          "provider_verified",
        );
        assert.equal(JSON.stringify(shared).includes(secondPet), false);
      },
    );
    await t.test(
      "authenticated members create/edit one review per place; no author spoofing or duplicate row creation",
      async () => {
        await asUser(a);
        reviewA = await value(
          "select public.save_service_review($1,5,'Lovely care') as result",
          [place],
        );
        const again = await value(
          "select public.save_service_review($1,4,'Updated experience') as result",
          [place],
        );
        assert.equal(again, reviewA);
        await denied(
          "insert into public.service_reviews(google_place_id,user_id,rating) values($1,$2,5)",
          [place, b],
        );
        await denied(
          "update public.service_reviews set user_id=$1 where id=$2",
          [b, reviewA],
        );
        await admin();
        await denied(
          "insert into public.service_reviews(google_place_id,user_id,rating) values($1,$2,3)",
          [place, a],
        );
        assert.equal(
          await value<number>(
            "select count(*)::int as result from public.service_reviews where user_id=$1 and google_place_id=$2",
            [a, place],
          ),
          1,
        );
        await asUser(b);
        reviewB = await value(
          "select public.save_service_review($1,2,'My separate review') as result",
          [place],
        );
        await denied("update public.service_reviews set rating=1 where id=$1", [
          reviewA,
        ]);
        await denied("delete from public.service_reviews where id=$1", [
          reviewA,
        ]);
        await denied("select public.withdraw_service_review($1)", [reviewA]);
        await asUser(a);
        const own = await value<{
          id: string;
          rating: number;
          comment: string;
        }>("select public.my_service_review($1) as result", [place]);
        assert.equal(own.rating, 4);
        assert.equal(own.id, reviewA);
      },
    );
    await t.test(
      "public aggregates are exclusively published PetThread ratings, and public projections contain no private identities",
      async () => {
        await asUser(null);
        const data = await value<{
          summary: { average: number; count: number };
          reviews: Record<string, unknown>[];
        }>("select public.read_service_reviews($1,0) as result", [place]);
        assert.equal(data.summary.average, 3);
        assert.equal(data.summary.count, 2);
        assert.deepEqual(
          Object.keys(data.reviews[0]).sort(),
          [
            "id",
            "rating",
            "comment",
            "created_at",
            "updated_at",
            "reviewer",
          ].sort(),
        );
        assert.equal(data.reviews[0].reviewer, "Pawport Member");
        for (const hidden of [
          a,
          b,
          vet,
          household,
          pet,
          secondPet,
          "@example.com",
          "Private Milo",
          "Private family",
          "user_id",
          "googleRating",
        ])
          assert.equal(JSON.stringify(data).includes(hidden), false);
        for (const sql of [
          "select user_id from public.service_reviews",
          "select * from public.service_reviews",
          "select email from auth.users",
          "select moderation_note from public.service_reviews",
        ])
          await denied(sql);
        assert.equal(
          (
            await pg.query(
              "select id,rating,comment from public.service_reviews",
            )
          ).rows.length,
          2,
        );
        assert.deepEqual(
          await value(
            "select public.service_community_summaries($1::text[]) as result",
            [[otherPlace]],
          ),
          { [otherPlace]: { average: null, count: 0 } },
        );
        await denied("select public.save_service_review($1,5,'anonymous')", [
          place,
        ]);
        await denied("select public.withdraw_service_review($1)", [reviewA]);
        await denied("select public.my_service_review($1)", [place]);
      },
    );
    await t.test(
      "withdrawal removes public review and rating; republishing reuses the same row",
      async () => {
        await asUser(a);
        await pg.query("select public.withdraw_service_review($1)", [reviewA]);
        await asUser(null);
        const data = await value<{
          summary: { average: number; count: number };
          reviews: { id: string }[];
        }>("select public.read_service_reviews($1,0) as result", [place]);
        assert.equal(data.summary.count, 1);
        assert.equal(data.summary.average, 2);
        assert.equal(
          data.reviews.some((r) => r.id === reviewA),
          false,
        );
        await asUser(a);
        assert.equal(
          await value(
            "select public.save_service_review($1,5,'Republished') as result",
            [place],
          ),
          reviewA,
        );
      },
    );
    await t.test(
      "favorites and ZIP preferences are private, contain no Google detail fields and cannot be spoofed",
      async () => {
        await asUser(a);
        await pg.query("select public.set_service_favorite($1,true)", [place]);
        await pg.query("select public.set_service_favorite($1,true)", [place]);
        assert.equal(
          (
            await pg.query(
              "select google_place_id from public.service_favorites",
            )
          ).rows.length,
          1,
        );
        await pg.query("select public.set_service_preference('02118',25)");
        await asUser(b);
        assert.equal(
          (
            await pg.query(
              "select google_place_id from public.service_favorites",
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await pg.query(
              "select postal_code,radius_miles from public.user_service_preferences",
            )
          ).rows.length,
          0,
        );
        await denied(
          "insert into public.service_favorites(user_id,google_place_id) values($1,$2)",
          [a, otherPlace],
        );
        await denied(
          "update public.user_service_preferences set postal_code='10001' where user_id=$1",
          [a],
        );
        await pg.query("select public.set_service_favorite($1,false)", [place]);
        await pg.query("select public.set_service_preference(null,10)");
        await asUser(a);
        assert.deepEqual(
          (
            await pg.query(
              "select postal_code,radius_miles from public.user_service_preferences",
            )
          ).rows,
          [{ postal_code: "02118", radius_miles: 25 }],
        );
        assert.equal(
          (
            await pg.query(
              "select google_place_id from public.service_favorites",
            )
          ).rows.length,
          1,
        );
        await pg.query("select public.set_service_favorite($1,false)", [place]);
        await pg.query("select public.set_service_preference(null,10)");
        assert.equal(
          (
            await pg.query(
              "select google_place_id from public.service_favorites",
            )
          ).rows.length,
          0,
        );
        assert.equal(
          (
            await pg.query(
              "select postal_code from public.user_service_preferences",
            )
          ).rows.length,
          0,
        );
        await asUser(null);
        await denied("select google_place_id from public.service_favorites");
        await denied("select postal_code from public.user_service_preferences");
        await denied("select public.set_service_favorite($1,true)", [place]);
      },
    );
    await t.test(
      "reports are unique per reporter/review, private and never auto-hide a review",
      async () => {
        await asUser(b);
        await pg.query(
          "select public.report_service_review($1,'spam','Please check')",
          [reviewA],
        );
        await denied(
          "select public.report_service_review($1,'other','Again')",
          [reviewA],
        );
        const report = (
          await pg.query<{ id: string }>(
            "select id from public.service_review_reports",
          )
        ).rows[0].id;
        await denied(
          "update public.service_review_reports set status='dismissed' where id=$1",
          [report],
        );
        await asUser(a);
        assert.equal(
          (await pg.query("select id from public.service_review_reports")).rows
            .length,
          0,
        );
        await denied("delete from public.service_review_reports where id=$1", [
          report,
        ]);
        await asUser(null);
        await denied("select id from public.service_review_reports");
        await denied("select public.report_service_review($1,'spam','')", [
          reviewA,
        ]);
        assert.equal(
          (
            await value<{ summary: { count: number } }>(
              "select public.read_service_reviews($1,0) as result",
              [place],
            )
          ).summary.count,
          2,
        );
      },
    );
    await t.test(
      "moderator hiding excludes content from public reads and aggregates; author cannot evade by edit or republish",
      async () => {
        await admin();
        await pg.query(
          "update public.service_reviews set hidden_at=now(),moderation_note='Reviewed by operator' where id=$1",
          [reviewA],
        );
        await asUser(null);
        assert.equal(
          (
            await pg.query(
              "select id from public.service_reviews where id=$1",
              [reviewA],
            )
          ).rows.length,
          0,
        );
        const data = await value<{
          summary: { count: number; average: number };
        }>("select public.read_service_reviews($1,0) as result", [place]);
        assert.equal(data.summary.count, 1);
        assert.equal(data.summary.average, 2);
        await asUser(a);
        await denied("select public.save_service_review($1,5,'Bypass')", [
          place,
        ]);
        await pg.query("select public.withdraw_service_review($1)", [reviewA]);
        await denied(
          "select public.save_service_review($1,5,'Bypass after withdraw')",
          [place],
        );
        await denied(
          "update public.service_reviews set hidden_at=null where id=$1",
          [reviewA],
        );
      },
    );
    await t.test(
      "SQL rejects invalid IDs, ratings, comments, reports, ZIP/radius and oversized aggregate requests",
      async () => {
        await asUser(a);
        for (const [id, rating, comment] of [
          ["../id", 5, ""],
          ["id", 0, ""],
          ["id", 6, ""],
          ["id", 5, "x".repeat(1501)],
        ])
          await denied("select public.save_service_review($1,$2,$3)", [
            id,
            rating,
            comment,
          ]);
        await denied("select public.set_service_preference('1234',10)");
        await denied("select public.set_service_preference('02118',51)");
        await denied("select public.report_service_review($1,'unknown','')", [
          reviewB,
        ]);
        await denied("select public.report_service_review($1,'spam',$2)", [
          reviewB,
          "x".repeat(501),
        ]);
        await denied("select public.service_community_summaries($1::text[])", [
          Array(21).fill(place),
        ]);
        await denied("select public.read_service_reviews($1,-1)", [place]);
      },
    );
  } finally {
    await pg.close();
  }
});
