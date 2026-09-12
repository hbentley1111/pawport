import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
test("Appointment requests: consent, ownership and transactional appointment creation", async (t) => {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const owner = randomUUID(),
    business = randomUUID(),
    staff = randomUUID(),
    foreign = randomUUID(),
    org = randomUUID(),
    location = randomUUID();
  const role = async (user?: string) => {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || "",
    ]);
    if (user) await pg.exec("set role authenticated");
  };
  const val = async <T = string>(sql: string, args: unknown[] = []) =>
    (await pg.query<{ v: T }>(sql, args)).rows[0]?.v;
  try {
    await pg.exec(
      `create role anon;create role authenticated;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`,
    );
    for (const f of (await readdir("supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    for (const id of [owner, business, staff, foreign])
      await pg.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
        [id, id + "@example.com"],
      );
    await pg.query(
      "insert into service_provider_organizations(id,name) values($1,'Provider entered business')",
      [org],
    );
    await pg.query(
      "insert into service_provider_locations(id,organization_id,google_place_id) values($1,$2,'ChIJ_RequestTest')",
      [location, org],
    );
    await pg.query(
      "insert into service_provider_memberships(organization_id,user_id,role) values($1,$2,'owner'),($1,$3,'staff')",
      [org, business, staff],
    );
    await pg.query(
      "insert into service_provider_location_profiles(location_id,profile_status,time_zone) values($1,'published','America/New_York')",
      [location],
    );
    const service = await val(
      "insert into service_provider_services(location_id,category,name) values($1,'veterinary','Wellness visit') returning id v",
      [location],
    );
    await role(owner);
    const household = await val(
      "insert into households(name) values('Request household') returning id v",
    );
    const pet = await val(
      "insert into pets(household_id,name,species,breed,sex) values($1,'Jaxson','Dog','Mixed','Male') returning id v",
      [household],
    );
    const start = new Date(Date.now() + 72 * 3600000).toISOString(),
      end = new Date(Date.now() + 74 * 3600000).toISOString();
    const windows = [{ starts_at: start, ends_at: end }];
    const submit = (p = pet, w = windows) =>
      val(
        "select submit_appointment_request($1,$2,$3,'Owner name','555-1234','Shared note',$4) v",
        [p, location, service, JSON.stringify(w)],
      );
    await t.test("Intake defaults off and staff cannot enable", async () => {
      await assert.rejects(submit());
      await role(staff);
      await assert.rejects(
        pg.query("select save_service_provider_request_settings($1,$2,$3)", [
          org,
          location,
          {
            requests_enabled: true,
            minimum_notice_hours: 24,
            maximum_advance_days: 60,
          },
        ]),
      );
      await role(business);
      await pg.query(
        "select save_service_provider_request_settings($1,$2,$3)",
        [
          org,
          location,
          {
            requests_enabled: true,
            minimum_notice_hours: 24,
            maximum_advance_days: 60,
          },
        ],
      );
      assert.equal(
        await val("select service_provider_request_intake($1) v", [location]),
        null,
      );
      await pg.query(
        "select set_service_provider_service_requestable($1,$2,$3,true)",
        [org, location, service],
      );
    });
    await role(owner);
    await t.test("Window constraints and foreign ownership", async () => {
      await assert.rejects(submit(randomUUID()));
      await assert.rejects(submit(pet, [...windows, ...windows]));
      await assert.rejects(submit(pet, Array(4).fill(windows[0])));
      await role(foreign);
      await assert.rejects(submit());
      await role(owner);
    });
    const request = await submit();
    await t.test(
      "Contact snapshot, private reads and duplicate requests",
      async () => {
        await assert.rejects(submit());
        await assert.rejects(pg.query("select * from appointment_requests"));
        await role(foreign);
        await assert.rejects(
          pg.query("select my_appointment_request($1)", [request]),
        );
        await role(staff);
        const dto = await val<Record<string, unknown>>(
          "select service_provider_appointment_request($1,$2) v",
          [org, request],
        );
        assert.equal(dto.contactEmail, owner + "@example.com");
        assert.equal(dto.petName, "Jaxson");
        for (const key of [
          "owner_id",
          "ownerId",
          "household_id",
          "petId",
          "householdId",
          "vaccinations",
          "carePlans",
        ])
          assert.equal(dto[key], undefined);
        await assert.rejects(
          pg.query("select confirm_appointment_request($1,$2,$3)", [
            request,
            start,
            end,
          ]),
        );
      },
    );
    await role(business);
    await t.test(
      "Direct confirmation requires the owner's preferred window",
      async () => {
        await assert.rejects(
          pg.query("select confirm_appointment_request($1,$2,$3)", [
            request,
            new Date(Date.now() + 80 * 3600000).toISOString(),
            new Date(Date.now() + 81 * 3600000).toISOString(),
          ]),
        );
      },
    );
    const appointment = await val(
      "select confirm_appointment_request($1,$2,$3) v",
      [request, start, end],
    );
    await t.test(
      "Confirmation is idempotent and creates the canonical appointment/reminders",
      async () => {
        assert.equal(
          await val("select confirm_appointment_request($1,$2,$3) v", [
            request,
            start,
            end,
          ]),
          appointment,
        );
        await role();
        const row = (
          await pg.query<{
            source: string;
            created_by: string;
            status: string;
          }>("select source,created_by,status from appointments where id=$1", [
            appointment,
          ])
        ).rows[0];
        assert.deepEqual(row, {
          source: "pawport",
          created_by: owner,
          status: "confirmed",
        });
        assert.equal(
          await val<number>(
            "select count(*)::integer v from appointment_reminders where appointment_id=$1",
            [appointment],
          ),
          2,
        );
        assert.equal(
          await val<number>(
            "select count(*)::integer v from notifications where appointment_request_id=$1",
            [request],
          ),
          1,
        );
      },
    );
    await t.test(
      "Owner cancellation preserves history and blocks competing cancellation",
      async () => {
        await role(owner);
        await pg.query("select cancel_requested_appointment_by_owner($1)", [
          request,
        ]);
        await role(business);
        await assert.rejects(
          pg.query("select cancel_requested_appointment_by_provider($1)", [
            request,
          ]),
        );
        await role();
        assert.equal(
          await val("select status v from appointments where id=$1", [
            appointment,
          ]),
          "cancelled",
        );
      },
    );
    await role(owner);
    const second = await submit();
    await role(business);
    const proposal = await val(
      "select propose_appointment_request_time($1,$2,$3,'Another time') v",
      [second, start, end],
    );
    const replacement = await val(
      "select propose_appointment_request_time($1,$2,$3,'Updated proposal') v",
      [second, start, end],
    );
    await t.test(
      "Superseded proposals cannot be accepted; acceptance is idempotent",
      async () => {
        await role(foreign);
        await assert.rejects(
          pg.query("select accept_appointment_request_proposal($1,$2)", [
            second,
            replacement,
          ]),
        );
        await role(owner);
        await assert.rejects(
          pg.query("select accept_appointment_request_proposal($1,$2)", [
            second,
            proposal,
          ]),
        );
        const a = await val(
          "select accept_appointment_request_proposal($1,$2) v",
          [second, replacement],
        );
        assert.equal(
          await val("select accept_appointment_request_proposal($1,$2) v", [
            second,
            replacement,
          ]),
          a,
        );
        await assert.rejects(
          pg.query("select withdraw_appointment_request($1)", [second]),
        );
      },
    );

    await t.test(
      "Scoped scheduling managers operate only assigned locations; staff cannot configure",
      async () => {
        await role();
        const manager = randomUUID(),
          otherLocation = randomUUID();
        await pg.query(
          "insert into auth.users(id,email,email_confirmed_at) values($1,'manager@example.com',now())",
          [manager],
        );
        await pg.query(
          "insert into service_provider_locations(id,organization_id,google_place_id) values($1,$2,'ChIJ_AnotherRequestLocation')",
          [otherLocation, org],
        );
        await role(business);
        const invitation = await val<{ token: string }>(
          "select create_service_provider_invitation($1,'manager@example.com','scheduling_manager','selected',$2) v",
          [org, [location]],
        );
        await role(manager);
        await pg.query("select accept_service_provider_invitation($1)", [
          invitation.token,
        ]);
        await pg.query("select service_provider_appointment_request($1,$2)", [
          org,
          second,
        ]);
        await assert.rejects(
          pg.query("select service_provider_request_settings($1,$2)", [
            org,
            otherLocation,
          ]),
        );
        await pg.query(
          "select set_service_provider_service_requestable($1,$2,$3,true)",
          [org, location, service],
        );
        await assert.rejects(
          pg.query("select save_service_provider_organization_profile($1,$2)", [
            org,
            { name: "Unauthorized profile edit" },
          ]),
        );
        await pg.query(
          "select cancel_requested_appointment_by_provider($1,'Cancelled by business')",
          [second],
        );
        await role(owner);
        await assert.rejects(
          pg.query("select cancel_requested_appointment_by_owner($1)", [
            second,
          ]),
        );
      },
    );
    await t.test(
      "Proposal decline returns request to waiting; withdrawal closes pending proposals",
      async () => {
        await role(owner);
        const r = await submit();
        await role(business);
        const q = await val(
          "select propose_appointment_request_time($1,$2,$3) v",
          [r, start, end],
        );
        await role(owner);
        await pg.query("select decline_appointment_request_proposal($1,$2)", [
          r,
          q,
        ]);
        assert.equal(
          (
            await val<{ status: string }>(
              "select my_appointment_request($1) v",
              [r],
            )
          ).status,
          "requested",
        );
        await role(business);
        await pg.query("select propose_appointment_request_time($1,$2,$3)", [
          r,
          start,
          end,
        ]);
        await role(owner);
        await pg.query("select withdraw_appointment_request($1)", [r]);
        await role(business);
        await assert.rejects(
          pg.query("select confirm_appointment_request($1,$2,$3)", [
            r,
            start,
            end,
          ]),
        );
      },
    );
    await t.test("Provider decline is terminal and owner-visible", async () => {
      await role(owner);
      const r = await submit();
      await role(business);
      await pg.query(
        "select decline_appointment_request($1,'Please contact the office')",
        [r],
      );
      await assert.rejects(
        pg.query("select confirm_appointment_request($1,$2,$3)", [
          r,
          start,
          end,
        ]),
      );
      await role(owner);
      assert.equal(
        (
          await val<{ responseNote: string }>(
            "select my_appointment_request($1) v",
            [r],
          )
        ).responseNote,
        "Please contact the office",
      );
    });
    await t.test(
      "Pending expiry is presented without a worker; expired proposals cannot be accepted",
      async () => {
        await role(owner);
        const r = await submit();
        await role(business);
        const q = await val(
          "select propose_appointment_request_time($1,$2,$3) v",
          [r, start, end],
        );
        await role();
        await pg.query(
          "update appointment_request_proposals set expires_at=now()-interval '1 minute' where id=$1",
          [q],
        );
        await role(owner);
        await assert.rejects(
          pg.query("select accept_appointment_request_proposal($1,$2)", [r, q]),
        );
        await role();
        await pg.query(
          "update appointment_requests set expires_at=now()-interval '1 minute' where id=$1",
          [r],
        );
        await role(owner);
        assert.equal(
          (
            await val<{ status: string }>(
              "select my_appointment_request($1) v",
              [r],
            )
          ).status,
          "expired",
        );
        await assert.rejects(pg.query("select expire_appointment_requests()"));
        await role();
        await pg.exec("set role pawport_appointment_worker");
        await pg.query("select expire_appointment_requests()");
        await role();
        assert.equal(
          await val("select status v from appointment_requests where id=$1", [
            r,
          ]),
          "expired",
        );
      },
    );
    await t.test(
      "Time-window minimum, notice, maximum horizon and three-window submission",
      async () => {
        await role(owner);
        for (const w of [
          [
            {
              starts_at: new Date(Date.now() - 3600000).toISOString(),
              ends_at: new Date(Date.now() + 3600000).toISOString(),
            },
          ],
          [
            {
              starts_at: new Date(Date.now() + 3600000).toISOString(),
              ends_at: new Date(Date.now() + 7200000).toISOString(),
            },
          ],
          [
            {
              starts_at: start,
              ends_at: new Date(Date.parse(start) + 60000).toISOString(),
            },
          ],
          [
            {
              starts_at: start,
              ends_at: new Date(Date.parse(start) + 9 * 3600000).toISOString(),
            },
          ],
          [
            {
              starts_at: new Date(Date.now() + 90 * 86400000).toISOString(),
              ends_at: new Date(
                Date.now() + 90 * 86400000 + 3600000,
              ).toISOString(),
            },
          ],
        ])
          await assert.rejects(submit(pet, w));
        const r = await submit(
          pet,
          [0, 1, 2].map((i) => ({
            starts_at: new Date(Date.parse(start) + i * 86400000).toISOString(),
            ends_at: new Date(Date.parse(end) + i * 86400000).toISOString(),
          })),
        );
        await pg.query("select withdraw_appointment_request($1)", [r]);
      },
    );
    await t.test(
      "Unpublished, suspended and inactive services close public intake",
      async () => {
        await role();
        await pg.query(
          "update service_provider_location_profiles set profile_status='unpublished' where location_id=$1",
          [location],
        );
        await role(owner);
        await assert.rejects(submit());
        await role();
        await pg.query(
          "update service_provider_location_profiles set profile_status='published' where location_id=$1",
          [location],
        );
        await pg.query(
          "update service_provider_locations set status='suspended' where id=$1",
          [location],
        );
        await role(owner);
        await assert.rejects(submit());
        await role();
        await pg.query(
          "update service_provider_locations set status='active' where id=$1",
          [location],
        );
        await pg.query(
          "update service_provider_organizations set status='suspended' where id=$1",
          [org],
        );
        await role(business);
        await assert.rejects(
          pg.query("select service_provider_request_settings($1,$2)", [
            org,
            location,
          ]),
        );
        await role();
        await pg.query(
          "update service_provider_organizations set status='active' where id=$1",
          [org],
        );
        await pg.query(
          "update service_provider_services set active=false where id=$1",
          [service],
        );
        await role(owner);
        await assert.rejects(submit());
        await role();
        await pg.query(
          "update service_provider_services set active=true where id=$1",
          [service],
        );
      },
    );
    await t.test(
      "Anonymous and direct mutation paths cannot inject requests, events or notifications",
      async () => {
        await role();
        await pg.exec("set role anon");
        await assert.rejects(pg.query("select my_appointment_requests()"));
        await assert.rejects(submit());
        await role(owner);
        for (const table of [
          "appointment_requests",
          "appointment_request_proposals",
          "appointment_request_events",
          "appointment_request_windows",
          "service_provider_request_settings",
          "notifications",
        ])
          await assert.rejects(pg.query(`insert into ${table} default values`));
        await assert.rejects(
          pg.query("select ar_transition($1,'confirm',$2,$3)", [
            request,
            start,
            end,
          ]),
        );
        await role();
        await assert.rejects(
          pg.query("update appointment_requests set owner_id=$1 where id=$2", [
            foreign,
            request,
          ]),
        );
        await assert.rejects(
          pg.query("update appointment_requests set pet_id=$1 where id=$2", [
            randomUUID(),
            request,
          ]),
        );
        await assert.rejects(
          pg.query(
            "update appointment_request_events set message='Rewritten' where request_id=$1",
            [request],
          ),
        );
        await assert.rejects(
          pg.query(
            "insert into notifications(user_id,type,title,body,action_url,dedupe_key,subject_pet_id,appointment_request_id) values($1,'appointment_request_update','Fake','Fake',$2,$3,$4,$5)",
            [
              foreign,
              "/appointments/requests/" + request,
              "appointment-request:" + request + ":fake",
              pet,
              request,
            ],
          ),
        );
        await assert.rejects(
          pg.query(
            "update notifications set appointment_request_id=$1 where appointment_request_id=$2",
            [second, request],
          ),
        );
      },
    );
    await t.test(
      "Confirmed requests cannot modify unrelated manual or external appointments",
      async () => {
        await role(owner);
        await assert.rejects(
          pg.query("select cancel_manual_appointment($1)", [appointment]),
        );
        await role();
        await assert.rejects(
          pg.query(
            "update appointment_requests set appointment_id=$1 where id=$2",
            [randomUUID(), request],
          ),
        );
        const dto = await val<Record<string, unknown>>(
          "select ar_dto($1,true) v",
          [request],
        );
        const serialized = JSON.stringify(dto);
        for (const secret of [
          '"' + owner + '"',
          household,
          pet,
          "credential_ref",
          "storage_path",
          "external_account_id",
        ])
          assert.equal(serialized.includes(secret), false);
      },
    );
    await t.test(
      "Confirmed Auth email is required and cannot be submitted from the browser",
      async () => {
        await role();
        await pg.query(
          "update auth.users set email_confirmed_at=null where id=$1",
          [owner],
        );
        await role(owner);
        await assert.rejects(submit());
        await role();
        await pg.query(
          "update auth.users set email_confirmed_at=now() where id=$1",
          [owner],
        );
      },
    );

    await t.test(
      "Concurrent repeat confirmations return one appointment",
      async () => {
        await role(owner);
        const r = await submit();
        await role(business);
        const results = await Promise.all([
          val("select confirm_appointment_request($1,$2,$3) v", [
            r,
            start,
            end,
          ]),
          val("select confirm_appointment_request($1,$2,$3) v", [
            r,
            start,
            end,
          ]),
        ]);
        assert.equal(results[0], results[1]);
        await role(owner);
        await assert.rejects(
          pg.query("select withdraw_appointment_request($1)", [r]),
        );
      },
    );
    await t.test(
      "Dashboard counts exclude expiry and contain no request detail",
      async () => {
        await role(owner);
        const r = await submit();
        await role(business);
        const d = await val<
          Array<{
            locations: Array<{
              newRequestCount: number;
              awaitingOwnerCount: number;
            }>;
          }>
        >("select my_service_provider_dashboard() v");
        assert.ok(d[0].locations.some((l) => l.newRequestCount >= 1));
        assert.equal(JSON.stringify(d).includes("contactEmail"), false);
        const q = await val(
          "select propose_appointment_request_time($1,$2,$3) v",
          [r, start, end],
        );
        await role(owner);
        const result = await Promise.all([
          val("select accept_appointment_request_proposal($1,$2) v", [r, q]),
          val("select accept_appointment_request_proposal($1,$2) v", [r, q]),
        ]);
        assert.equal(result[0], result[1]);
        await role(business);
        await assert.rejects(
          pg.query("select propose_appointment_request_time($1,$2,$3)", [
            r,
            start,
            end,
          ]),
        );
      },
    );
    await t.test(
      "Daily and open-request caps cannot be bypassed with different services",
      async () => {
        await role();
        await pg.exec("begin");
        try {
          const current = await val<number>(
            "select count(*)::integer v from appointment_requests where owner_id=$1 and created_at>now()-interval '1 day'",
            [owner],
          );
          await role(owner);
          for (let i = current; i < 20; i++) {
            const r = await submit();
            await pg.query("select withdraw_appointment_request($1)", [r]);
          }
          await assert.rejects(submit(), /Request limit reached/);
        } finally {
          await pg.exec("rollback");
        }
        await role();
        await pg.exec("begin");
        try {
          const fresh = randomUUID();
          await pg.query(
            "insert into auth.users(id,email,email_confirmed_at) values($1,'limits@example.com',now())",
            [fresh],
          );
          await role(fresh);
          const hh = await val(
            "insert into households(name) values('Limits') returning id v",
          );
          const pp = await val(
            "insert into pets(household_id,name,species,breed,sex) values($1,'Limit pet','Dog','Mixed','Male') returning id v",
            [hh],
          );
          for (let i = 0; i < 11; i++) {
            await role();
            const svc = await val(
              "insert into service_provider_services(location_id,category,name,accepts_appointment_requests) values($1,'other','Test service',true) returning id v",
              [location],
            );
            await role(fresh);
            const call = () =>
              val(
                "select submit_appointment_request($1,$2,$3,'Owner',null,null,$4) v",
                [pp, location, svc, JSON.stringify(windows)],
              );
            if (i < 10) await call();
            else await assert.rejects(call(), /Request limit reached/);
          }
        } finally {
          await pg.exec("rollback");
        }
      },
    );
    await t.test(
      "Business participation creates no medical or scheduling authority",
      async () => {
        await role();
        for (const table of [
          "veterinary_providers",
          "provider_memberships",
          "provider_scheduling_permissions",
        ])
          assert.equal(
            await val<number>(`select count(*)::integer v from ${table}`),
            0,
          );
      },
    );
  } finally {
    await pg.close();
  }
});
