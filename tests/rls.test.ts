import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
// Run only against a dedicated test project with the migration applied.
const url = process.env.TEST_SUPABASE_URL;
const key = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const service = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
test(
  "database isolates tenants and enforces share scope, expiry and revocation",
  { skip: !url || !key || !service },
  async () => {
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(url!, service!, opts);
    const anon = createClient(url!, key!, opts);
    const clients = [
      createClient(url!, key!, opts),
      createClient(url!, key!, opts),
    ];
    const users: string[] = [];
    const pets: string[] = [];
    const households: string[] = [];
    try {
      for (const client of clients) {
        const email = `pawport-test-${randomUUID()}@example.com`;
        const password = randomUUID() + randomUUID();
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        assert.ifError(error);
        users.push(data.user!.id);
        assert.ifError(
          (await client.auth.signInWithPassword({ email, password })).error,
        );
        const h = await client
          .from("households")
          .insert({ name: "Test household" })
          .select("id")
          .single();
        assert.ifError(h.error);
        households.push(h.data!.id);
        const p = await client
          .from("pets")
          .insert({
            household_id: h.data!.id,
            name: "Test pet",
            species: "Dog",
            breed: "Mixed",
            sex: "Unknown",
            microchip: "123456789",
          })
          .select("id")
          .single();
        assert.ifError(p.error);
        pets.push(p.data!.id);
      }
      const [a, b] = clients;
      for (const table of [
        "households",
        "pets",
        "vaccinations",
        "share_passes",
      ]) {
        const result = await anon.from(table).select("id");
        assert.ok(
          result.error || result.data?.length === 0,
          `anonymous cannot read ${table}`,
        );
      }
      assert.equal(
        (await a.from("households").select("id").eq("id", households[1])).data
          ?.length,
        0,
      );
      assert.equal(
        (await a.from("pets").select("id").eq("id", pets[1])).data?.length,
        0,
      );
      assert.ok(
        (
          await a
            .from("households")
            .insert({ owner_id: users[1], name: "Hijack" })
        ).error,
      );
      assert.ok(
        (
          await a
            .from("pets")
            .insert({
              household_id: households[1],
              name: "Hijack",
              species: "Cat",
              breed: "Mixed",
              sex: "Unknown",
            })
        ).error,
      );
      const record = {
        pet_id: pets[0],
        name: "Rabies",
        administered_on: "2025-01-01",
        due_on: "2026-01-01",
        clinic: "Test clinic",
      };
      assert.ifError((await a.from("vaccinations").insert(record)).error);
      assert.equal(
        (await b.from("vaccinations").select("id").eq("pet_id", pets[0])).data
          ?.length,
        0,
      );
      assert.ok((await b.from("vaccinations").insert(record)).error);
      assert.ok(
        (await b.rpc("create_share_pass", { p_pet_id: pets[0], p_hours: 24 }))
          .error,
      );
      assert.ok(
        (await a.rpc("create_share_pass", { p_pet_id: pets[0], p_hours: 169 }))
          .error,
      );
      const created = await a.rpc("create_share_pass", {
        p_pet_id: pets[0],
        p_hours: 24,
      });
      assert.ifError(created.error);
      const pass = created.data;
      assert.match(pass.token, /^[0-9a-f]{64}$/);
      assert.ok((await a.from("share_passes").select("token_hash")).error);
      assert.equal(
        (await b.from("share_passes").select("id").eq("id", pass.id)).data
          ?.length,
        0,
      );
      assert.ok(
        (await b.rpc("revoke_share_pass", { p_pass_id: pass.id })).error,
      );
      const shared = await anon.rpc("read_share_pass", { p_token: pass.token });
      assert.ifError(shared.error);
      assert.deepEqual(Object.keys(shared.data).sort(), [
        "expires_at",
        "pet",
        "vaccinations",
      ]);
      assert.deepEqual(Object.keys(shared.data.pet).sort(), [
        "birth_date",
        "breed",
        "name",
        "sex",
        "species",
      ]);
      assert.equal(shared.data.vaccinations.length, 1);
      for (const p_token of ["invalid", "a".repeat(64)])
        assert.equal(
          (await anon.rpc("read_share_pass", { p_token })).data,
          null,
        );
      assert.ifError(
        (await a.rpc("revoke_share_pass", { p_pass_id: pass.id })).error,
      );
      assert.equal(
        (await anon.rpc("read_share_pass", { p_token: pass.token })).data,
        null,
      );
      const exp = await a.rpc("create_share_pass", {
        p_pet_id: pets[0],
        p_hours: 1,
      });
      assert.ifError(exp.error);
      assert.ifError(
        (
          await admin
            .from("share_passes")
            .update({
              created_at: new Date(Date.now() - 7200000).toISOString(),
              expires_at: new Date(Date.now() - 3600000).toISOString(),
            })
            .eq("id", exp.data.id)
        ).error,
      );
      assert.equal(
        (await anon.rpc("read_share_pass", { p_token: exp.data.token })).data,
        null,
      );
      for (let i = 0; i < 5; i++)
        assert.ifError(
          (await a.rpc("create_share_pass", { p_pet_id: pets[0], p_hours: 1 }))
            .error,
        );
      assert.ok(
        (await a.rpc("create_share_pass", { p_pet_id: pets[0], p_hours: 1 }))
          .error,
      );
    } finally {
      for (const id of users) {
        const result = await admin.auth.admin.deleteUser(id);
        assert.ifError(result.error);
      }
    }
  },
);
