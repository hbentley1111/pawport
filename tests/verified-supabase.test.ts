import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
const url = process.env.TEST_SUPABASE_URL,
  key = process.env.TEST_SUPABASE_PUBLISHABLE_KEY,
  service = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
test(
  "hosted Supabase private Storage and provider verification",
  { skip: !url || !key || !service },
  async () => {
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    const admin = createClient(url!, service!, options),
      anon = createClient(url!, key!, options);
    const accounts = [
      createClient(url!, key!, options),
      createClient(url!, key!, options),
      createClient(url!, key!, options),
    ];
    const users: string[] = [];
    let providerId: string | undefined;
    let documentPath: string | undefined;
    let petId: string | undefined;
    let householdId: string | undefined;
    try {
      for (const client of accounts) {
        const email = `pawport-records-${randomUUID()}@example.com`,
          password = randomUUID() + randomUUID();
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
      }
      const [owner, other, vet] = accounts;
      const h = await owner
        .from("households")
        .insert({ name: "Verification test" })
        .select("id")
        .single();
      assert.ifError(h.error);
      householdId = h.data!.id;
      const p = await owner
        .from("pets")
        .insert({
          household_id: householdId,
          name: "Milo",
          species: "Dog",
          breed: "Mixed",
          sex: "Male",
        })
        .select("id")
        .single();
      assert.ifError(p.error);
      petId = p.data!.id;
      const v = await owner
        .from("vaccinations")
        .insert({
          pet_id: petId,
          name: "Rabies",
          administered_on: "2025-01-01",
          clinic: "Test clinic",
        })
        .select("id")
        .single();
      assert.ifError(v.error);
      const pass = await owner.rpc("create_share_pass", {
        p_pet_id: petId,
        p_hours: 1,
      });
      assert.ifError(pass.error);
      const clinic = await admin
        .from("veterinary_providers")
        .insert({ name: "Test authorized clinic" })
        .select("id")
        .single();
      assert.ifError(clinic.error);
      providerId = clinic.data!.id;
      assert.ifError(
        (
          await admin
            .from("provider_memberships")
            .insert({ provider_id: providerId, user_id: users[2] })
        ).error,
      );
      assert.ok(
        (
          await owner
            .from("provider_memberships")
            .insert({ provider_id: providerId, user_id: users[0] })
        ).error,
      );
      const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
      const prep = await owner.rpc("prepare_health_document", {
        p_pet: petId,
        p_name: "visit.pdf",
        p_mime: "application/pdf",
        p_size: bytes.length,
      });
      assert.ifError(prep.error);
      documentPath = prep.data.path;
      assert.ok(
        (
          await other.storage
            .from("health-documents")
            .upload(documentPath!, bytes, { contentType: "application/pdf" })
        ).error,
      );
      assert.ifError(
        (
          await owner.storage
            .from("health-documents")
            .upload(documentPath!, bytes, {
              contentType: "application/pdf",
              upsert: false,
            })
        ).error,
      );
      assert.ifError(
        (
          await owner.rpc("finalize_health_document", {
            p_document: prep.data.id,
          })
        ).error,
      );
      assert.ifError(
        (
          await owner.rpc("attach_vaccination_document", {
            p_vaccination: v.data!.id,
            p_document: prep.data.id,
          })
        ).error,
      );
      assert.ifError(
        (await owner.storage.from("health-documents").download(documentPath!))
          .error,
      );
      assert.ok(
        (await other.storage.from("health-documents").download(documentPath!))
          .error,
      );
      assert.ok(
        (await anon.storage.from("health-documents").download(documentPath!))
          .error,
      );
      assert.equal(
        (await other.from("health_documents").select("id")).data?.length,
        0,
      );
      const r = await owner.rpc("request_vaccination_verification", {
        p_vaccination: v.data!.id,
        p_provider: providerId,
      });
      assert.ifError(r.error);
      assert.ok(
        (
          await owner.rpc("complete_vaccination_verification", {
            p_request: r.data,
            p_notes: "",
          })
        ).error,
      );
      assert.ok(
        (
          await other.rpc("complete_vaccination_verification", {
            p_request: r.data,
            p_notes: "",
          })
        ).error,
      );
      assert.ifError(
        (await vet.storage.from("health-documents").download(documentPath!))
          .error,
      );
      assert.ifError(
        (
          await vet.rpc("complete_vaccination_verification", {
            p_request: r.data,
            p_notes: "Private note",
          })
        ).error,
      );
      assert.ok(
        (await vet.storage.from("health-documents").download(documentPath!))
          .error,
      );
      const shared = await anon.rpc("read_share_pass", {
        p_token: pass.data.token,
      });
      assert.ifError(shared.error);
      assert.equal(
        shared.data.vaccinations[0].verification_status,
        "provider_verified",
      );
      assert.equal(
        shared.data.vaccinations[0].verified_by,
        "Test authorized clinic",
      );
      assert.equal(JSON.stringify(shared.data).includes(prep.data.id), false);
      assert.ifError(
        (await vet.rpc("close_vaccination_verification", { p_request: r.data }))
          .error,
      );
      assert.equal(
        (await anon.rpc("read_share_pass", { p_token: pass.data.token })).data
          .vaccinations[0].verification_status,
        "document_supported",
      );
      assert.ifError(
        (await owner.rpc("revoke_share_pass", { p_pass_id: pass.data.id }))
          .error,
      );
      assert.equal(
        (await anon.rpc("read_share_pass", { p_token: pass.data.token })).data,
        null,
      );
    } finally {
      // Test project only. Clean references before deleting the test clinic and identities.
      if (documentPath)
        assert.ifError(
          (await admin.storage.from("health-documents").remove([documentPath]))
            .error,
        );
      if (petId) {
        assert.ifError(
          (await admin.from("vaccinations").delete().eq("pet_id", petId)).error,
        );
        assert.ifError(
          (await admin.from("health_documents").delete().eq("pet_id", petId))
            .error,
        );
      }
      if (householdId)
        assert.ifError(
          (
            await admin
              .from("health_audit_events")
              .delete()
              .eq("household_id", householdId)
          ).error,
        );
      if (providerId) {
        assert.ifError(
          (
            await admin
              .from("provider_memberships")
              .delete()
              .eq("provider_id", providerId)
          ).error,
        );
        assert.ifError(
          (
            await admin
              .from("veterinary_providers")
              .delete()
              .eq("id", providerId)
          ).error,
        );
      }
      for (const user of users)
        assert.ifError((await admin.auth.admin.deleteUser(user)).error);
    }
  },
);
