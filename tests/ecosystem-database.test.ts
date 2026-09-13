import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type {
  QuoteRequest,
  Ecosystem,
  Management,
} from "../lib/ecosystem/schema";
import type { Planned } from "../lib/costs/schema";
test("Ecosystem quotes, offers, review responses and private partner foundation", async (t) => {
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
    await role();
    const location = await value(
      "insert into service_provider_locations(organization_id,google_place_id) values($1,'ChIJ-ecosystem') returning id v",
      [organization],
    );
    await pg.query(
      "insert into service_provider_location_profiles(location_id,profile_status,time_zone) values($1,'published','America/New_York')",
      [location],
    );
    const service = await value(
      "insert into service_provider_services(location_id,category,name) values($1,'veterinary','Dental cleaning') returning id v",
      [location],
    );
    const staff = randomUUID();
    await pg.query("insert into auth.users values($1,$2,now())", [
      staff,
      "staff@example.com",
    ]);
    await pg.query(
      "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'staff')",
      [organization, staff],
    );
    const send = (request: string, data: object) =>
      value("select send_service_quote($1,$2,$3) v", [
        organization,
        request,
        JSON.stringify(data),
      ]);
    const intake = () =>
      value<Ecosystem>("select public_business_ecosystem($1) v", [location]);
    const request = () =>
      value("select submit_service_quote_request($1,$2,$3,$4) v", [
        pet,
        location,
        service,
        "Please provide a general service quote.",
      ]);
    let r: string, q: string, plannedId: string;
    await t.test(
      "Opt-in, owner-only submission and safe scoped provider read",
      async () => {
        await role(owner);
        await assert.rejects(request());
        await role(staff);
        await assert.rejects(
          value("select set_service_quote_requests($1,$2,$3,true) v", [
            organization,
            location,
            service,
          ]),
        );
        await role(business);
        await value("select set_service_quote_requests($1,$2,$3,true) v", [
          organization,
          location,
          service,
        ]);
        await role(owner);
        r = await request();
        await assert.rejects(request());
        await role(foreign);
        await assert.rejects(request());
        await assert.rejects(
          value("select my_service_quote_requests($1,$2) v", [pet, r]),
        );
        await assert.rejects(
          value("select service_provider_quote_requests($1) v", [organization]),
        );
        await role(staff);
        const rows = await value<QuoteRequest[]>(
          "select service_provider_quote_requests($1) v",
          [organization],
        );
        assert.equal(rows[0].pet?.name, "Jaxson");
        assert.doesNotMatch(
          JSON.stringify(rows),
          /household|owner_id|petId|vaccination|insurance|budget|credential|external_|created_by/,
        );
        await assert.rejects(
          send(r, { amount_type: "exact", amount_cents: 65000 }),
        );
        await role(undefined, "anon");
        await assert.rejects(value("select my_service_quote_requests() v"));
        assert.equal((await intake()).services.length, 1);
      },
    );
    await t.test(
      "Exact/range/contact prices, bounded fields and immutable revision history",
      async () => {
        await role(business);
        for (const data of [
          { amount_type: "exact", amount_cents: -1 },
          {
            amount_type: "range",
            minimum_amount_cents: 90000,
            maximum_amount_cents: 65000,
          },
          { amount_type: "contact_for_price", amount_cents: 1 },
          { amount_type: "exact", amount_cents: 1, currency: "EUR" },
        ])
          await assert.rejects(send(r, data));
        q = await send(r, { amount_type: "exact", amount_cents: 65000 });
        await role(owner);
        plannedId = await value(
          "select save_quote_to_planning($1,$2,2026,$3) v",
          [pet, r, "dental"],
        );
        const p = await value<Planned>("select my_pet_planned_cost($1,$2) v", [
          pet,
          plannedId,
        ]);
        assert.equal(p.source, "provider_quote");
        assert.equal(p.plannedAmountCents, "65000");
        assert.equal(
          await value("select save_quote_to_planning($1,$2,2026,$3) v", [
            pet,
            r,
            "dental",
          ]),
          plannedId,
        );
        await assert.rejects(
          value("select save_pet_planned_cost($1,$2,$3) v", [
            pet,
            plannedId,
            JSON.stringify({
              title: "Fake",
              category: "dental",
              planning_year: 2026,
              planned_amount_cents: 1,
            }),
          ]),
        );
        await role(business);
        await send(r, {
          amount_type: "range",
          minimum_amount_cents: 65000,
          maximum_amount_cents: 90000,
        });
        await role(owner);
        const unchanged = await value<Planned>(
          "select my_pet_planned_cost($1,$2) v",
          [pet, plannedId],
        );
        assert.equal(unchanged.plannedAmountCents, "65000");
        assert.equal(unchanged.quoteUpdated, true);
        await value("select save_quote_to_planning($1,$2,2026,$3,true) v", [
          pet,
          r,
          "dental",
        ]);
        assert.equal(
          (
            await value<Planned>("select my_pet_planned_cost($1,$2) v", [
              pet,
              plannedId,
            ])
          ).plannedAmountCents,
          null,
        );
        await role(business);
        await send(r, { amount_type: "contact_for_price" });
        await role(owner);
        await value("select save_quote_to_planning($1,$2,2026,$3,true) v", [
          pet,
          r,
          "dental",
        ]);
        const rows = await value<QuoteRequest[]>(
          "select my_service_quote_requests($1,$2) v",
          [pet, r],
        );
        assert.equal(rows[0].history.length, 3);
        assert.equal(rows[0].history[2].amountCents, "65000");
        assert.equal(rows[0].currentQuote?.amountType, "contact_for_price");
        const notifications = await value<{
          notifications: { type: string }[];
        }>("select my_notifications() v");
        assert.equal(
          notifications.notifications.filter(
            (n) => n.type === "provider_quote_update",
          ).length,
          3,
        );
        await role();
        assert.equal(
          await value<number>("select count(*)::int v from pet_expenses"),
          0,
        );
        assert.equal(
          await value<number>("select count(*)::int v from appointments"),
          0,
        );
        assert.equal(
          await value<number>("select count(*)::int v from insurance_claims"),
          0,
        );
        await assert.rejects(
          pg.query(
            "update service_quote_versions set amount_cents=1 where quote_id=$1",
            [q],
          ),
        );
        await role(owner);
      },
    );
    await t.test(
      "Withdraw/decline/expiration block future conversion and foreign actors",
      async () => {
        await role(foreign);
        await assert.rejects(
          value("select save_quote_to_planning($1,$2,2026,$3) v", [
            pet,
            r,
            "dental",
          ]),
        );
        await role(owner);
        await value("select withdraw_service_quote_request($1,$2) v", [pet, r]);
        await assert.rejects(
          value("select save_quote_to_planning($1,$2,2026,$3,true) v", [
            pet,
            r,
            "dental",
          ]),
        );
        await role(business);
        await assert.rejects(
          send(r, { amount_type: "exact", amount_cents: 1 }),
        );
        await role(owner);
        const next = await request();
        await role(business);
        await value("select close_service_quote($1,$2,$3) v", [
          organization,
          next,
          "declined",
        ]);
        await assert.rejects(
          send(next, { amount_type: "exact", amount_cents: 1 }),
        );
        await role(owner);
        const expired = await request();
        await role(business);
        await send(expired, {
          amount_type: "exact",
          amount_cents: 1,
          valid_until: "2000-01-01",
        });
        await role(owner);
        assert.equal(
          (
            await value<QuoteRequest[]>(
              "select my_service_quote_requests($1,$2) v",
              [pet, expired],
            )
          )[0].currentQuote?.status,
          "expired",
        );
        await assert.rejects(
          value("select save_quote_to_planning($1,$2,2026,$3) v", [
            pet,
            expired,
            "dental",
          ]),
        );
      },
    );
    await t.test(
      "Offers are opt-in business information, with publication and date guards",
      async () => {
        const offer = {
          title: "New client offer",
          description: "Ask our business for terms.",
          offer_type: "new_client",
          value_text: "$25 off",
          status: "draft",
        };
        const save = (data: object, id: string | null = null) =>
          value("select save_service_provider_offer($1,$2,$3,$4) v", [
            organization,
            location,
            id,
            JSON.stringify(data),
          ]);
        await role(staff);
        await assert.rejects(save(offer));
        await role(foreign);
        await assert.rejects(save(offer));
        await role(business);
        const o = await save(offer);
        assert.equal((await intake()).offers.length, 0);
        await save({ ...offer, status: "published" }, o);
        assert.equal((await intake()).offers[0].valueText, "$25 off");
        assert.doesNotMatch(
          JSON.stringify((await intake()).offers),
          /created_by|membership|credential/,
        );
        await save({ ...offer, status: "published", ends_on: "2000-01-01" }, o);
        assert.equal((await intake()).offers.length, 0);
        await save({ ...offer, status: "published" }, o);
        await role();
        await pg.query(
          "update service_provider_organizations set status='suspended' where id=$1",
          [organization],
        );
        assert.equal(await intake(), null);
        await role(business);
        await assert.rejects(save(offer, o));
        await role();
        await pg.query(
          "update service_provider_organizations set status='active' where id=$1",
          [organization],
        );
      },
    );
    await t.test(
      "Business review responses preserve reviewer privacy and ratings; reports are private",
      async () => {
        await role(owner);
        const review = await value(
          "select save_service_review('ChIJ-ecosystem',5,'Helpful visit') v",
        );
        await role(business);
        const response = await value(
          "select save_service_review_response($1,$2,$3,$4) v",
          [organization, location, review, "Thank you for the feedback."],
        );
        await value("select save_service_review_response($1,$2,$3,$4) v", [
          organization,
          location,
          review,
          "Thank you for sharing.",
        ]);
        await role(undefined, "anon");
        const d = await intake();
        assert.equal(d.reviews.reviews[0].reviewer, "Pawport Member");
        assert.equal(d.reviews.reviews[0].rating, 5);
        assert.equal(d.reviews.reviews[0].response?.responseId, response);
        assert.doesNotMatch(
          JSON.stringify(d.reviews),
          /user_id|email|household|created_by/,
        );
        await role(foreign);
        await assert.rejects(
          value("select save_service_review_response($1,$2,$3,$4) v", [
            organization,
            location,
            review,
            "Spoof",
          ]),
        );
        await value("select report_service_review_response($1,$2,$3) v", [
          response,
          "privacy",
          "Please review",
        ]);
        await assert.rejects(
          pg.query("select * from service_review_response_reports"),
        );
        await role(business);
        await value("select save_service_review_response($1,$2,$3,$4,$5) v", [
          organization,
          location,
          review,
          "Thank you",
          "withdrawn",
        ]);
        assert.equal((await intake()).reviews.reviews[0].response, null);
        const m = await value<Management>(
          "select my_business_ecosystem($1) v",
          [organization],
        );
        assert.ok(m.reviewsAwaitingResponse > 0);
      },
    );
    await t.test(
      "Selected-location scope, suspension and immutable request identity",
      async () => {
        await role();
        const other = await value(
          "insert into service_provider_locations(organization_id,google_place_id) values($1,'ChIJ-ecosystem-other') returning id v",
          [organization],
        );
        const membership = await value(
          "select id v from service_provider_memberships where user_id=$1",
          [staff],
        );
        await pg.exec("begin");
        await pg.query(
          "update service_provider_memberships set location_scope='selected' where id=$1",
          [membership],
        );
        await pg.query(
          "insert into service_provider_membership_locations(membership_id,location_id) values($1,$2)",
          [membership, other],
        );
        await pg.exec("commit");
        await role(staff);
        assert.deepEqual(
          await value("select service_provider_quote_requests($1) v", [
            organization,
          ]),
          [],
        );
        await assert.rejects(
          value("select service_provider_quote_requests($1,$2) v", [
            organization,
            r,
          ]),
        );
        await role();
        await pg.query(
          "update service_provider_memberships set role='scheduling_manager' where id=$1",
          [membership],
        );
        await role(staff);
        await assert.rejects(
          send(r, { amount_type: "exact", amount_cents: 100 }),
        );
        await role();
        await assert.rejects(
          pg.query("update service_quote_requests set pet_id=$1 where id=$2", [
            randomUUID(),
            r,
          ]),
        );
        await pg.query(
          "update service_provider_locations set status='suspended' where id=$1",
          [location],
        );
        await role(owner);
        await assert.rejects(request());
        await role(business);
        await assert.rejects(
          value("select set_service_quote_requests($1,$2,$3,true) v", [
            organization,
            location,
            service,
          ]),
        );
        await role();
        await pg.query(
          "update service_provider_locations set status='active' where id=$1",
          [location],
        );
        await pg.exec("begin");
        await pg.query(
          "delete from service_provider_membership_locations where membership_id=$1",
          [membership],
        );
        await pg.query(
          "update service_provider_memberships set location_scope='all' where id=$1",
          [membership],
        );
        await pg.exec("commit");
      },
    );
    await t.test(
      "Serialized revisions and conversion preserve one quote and one plan; bounds enforced",
      async () => {
        await role(owner);
        const req = await request();
        await role(business);
        const results = await Promise.all([
          send(req, { amount_type: "exact", amount_cents: 100 }),
          send(req, { amount_type: "exact", amount_cents: 200 }),
        ]);
        assert.equal(results[0], results[1]);
        await role(owner);
        const plans = await Promise.all([
          value("select save_quote_to_planning($1,$2,2026,$3) v", [
            pet,
            req,
            "dental",
          ]),
          value("select save_quote_to_planning($1,$2,2026,$3) v", [
            pet,
            req,
            "dental",
          ]),
        ]);
        assert.equal(plans[0], plans[1]);
        await assert.rejects(
          value("select save_pet_planned_cost($1,null,$2) v", [
            pet,
            JSON.stringify({
              title: "Spoof",
              category: "dental",
              planning_year: 2026,
              source: "provider_quote",
              quote_id: results[0],
            }),
          ]),
        );
        await role(business);
        for (let n = 3; n <= 25; n++)
          await send(req, { amount_type: "exact", amount_cents: n });
        await assert.rejects(
          send(req, { amount_type: "exact", amount_cents: 26 }),
        );
        await role(owner);
        await value("select withdraw_service_quote_request($1,$2) v", [
          pet,
          req,
        ]);
        await role(business);
        await assert.rejects(
          send(req, { amount_type: "exact", amount_cents: 1 }),
        );
        await role();
        await assert.rejects(
          pg.query(
            "insert into notifications(user_id,type,title,body,action_url,dedupe_key,subject_pet_id,quote_request_id) values($1,'provider_quote_update','Bad','Bad',$2,$3,$4,$5)",
            [
              foreign,
              "/pets/" + pet + "/quotes/" + req,
              "provider-quote:" + req + ":forged",
              pet,
              req,
            ],
          ),
        );
      },
    );
    await t.test(
      "Operator report queue and moderation never grant business moderation rights",
      async () => {
        await role();
        const response = await value(
          "select id v from service_review_responses limit 1",
        );
        const review = await value(
          "select review_id v from service_review_responses where id=$1",
          [response],
        );
        await role(business);
        await value("select save_service_review_response($1,$2,$3,$4) v", [
          organization,
          location,
          review,
          "Public reply",
        ]);
        await assert.rejects(
          value("select operator_review_response_reports() v"),
        );
        await assert.rejects(
          value("select operator_moderate_review_response($1) v", [response]),
        );
        await role(undefined, "pawport_partner_operator");
        const reports = await value<unknown[]>(
          "select operator_review_response_reports() v",
        );
        assert.equal(reports.length, 1);
        assert.doesNotMatch(
          JSON.stringify(reports),
          /reporter_id|email|household/,
        );
        await value("select operator_moderate_review_response($1) v", [
          response,
        ]);
        await role(business);
        await assert.rejects(
          value("select save_service_review_response($1,$2,$3,$4) v", [
            organization,
            location,
            review,
            "Cannot restore",
          ]),
        );
        assert.equal((await intake()).reviews.reviews[0].response, null);
      },
    );
    await t.test(
      "Ten open requests and twenty daily requests cannot be bypassed",
      async () => {
        await role();
        const ids: string[] = [];
        for (let n = 0; n < 11; n++)
          ids.push(
            await value(
              "insert into service_provider_services(location_id,category,name,accepts_quote_requests) values($1,'other',$2,true) returning id v",
              [location, "Service " + n],
            ),
          );
        await role(owner);
        const pending: string[] = [];
        for (let n = 0; n < 10; n++)
          pending.push(
            await value("select submit_service_quote_request($1,$2,$3) v", [
              pet,
              location,
              ids[n],
            ]),
          );
        await assert.rejects(
          value("select submit_service_quote_request($1,$2,$3) v", [
            pet,
            location,
            ids[10],
          ]),
        );
        for (const id of pending)
          await value("select withdraw_service_quote_request($1,$2) v", [
            pet,
            id,
          ]);
        await role();
        const count = await value<number>(
          "select count(*)::int v from service_quote_requests where owner_id=$1",
          [owner],
        );
        await role(owner);
        for (let n = count; n < 20; n++) {
          const id = await request();
          await value("select withdraw_service_quote_request($1,$2) v", [
            pet,
            id,
          ]);
        }
        await assert.rejects(request());
      },
    );
    await t.test(
      "Partner foundation is internal only and grants no medical or scheduling rights",
      async () => {
        await role(business);
        for (const table of [
          "service_quote_requests",
          "service_quotes",
          "service_quote_versions",
          "service_provider_offers",
          "service_review_responses",
          "partner_organizations",
          "partner_connections",
        ])
          await assert.rejects(pg.query("select * from " + table));
        await assert.rejects(
          value(
            "select operator_save_partner(null,'candidate','Candidate','other','active') v",
          ),
        );
        await role();
        await pg.exec("set role pawport_partner_operator");
        const partner = await value(
          "select operator_save_partner(null,'candidate','Candidate','other','candidate') v",
        );
        await assert.rejects(
          value(
            "select operator_save_partner_connection(null,$1,null,null,null,'foundation',null,'active') v",
            [partner],
          ),
        );
        await role();
        assert.equal(
          await value<number>(
            "select count(*)::int v from veterinary_providers",
          ),
          0,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from provider_memberships",
          ),
          0,
        );
        assert.equal(
          await value<number>(
            "select count(*)::int v from provider_scheduling_permissions",
          ),
          0,
        );
        await role(owner);
        const pass = await value<{ token: string }>(
          "select create_share_pass($1,24) v",
          [pet],
        );
        await role(undefined, "anon");
        assert.doesNotMatch(
          JSON.stringify(
            await value("select read_share_pass($1) v", [pass.token]),
          ),
          /quote|offer|partner|expense|budget/,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
