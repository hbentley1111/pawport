import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.TEST_SUPABASE_URL,
  key = process.env.TEST_SUPABASE_PUBLISHABLE_KEY,
  service = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
// Dedicated staging project only, with all three migrations installed.
test(
  "hosted multi-pet limit races and private photo Storage lifecycle",
  { skip: !url || !key || !service },
  async () => {
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    const admin = createClient(url!, service!, options),
      owner = createClient(url!, key!, options),
      other = createClient(url!, key!, options),
      anon = createClient(url!, key!, options);
    const users: string[] = [],
      paths: string[] = [],
      pets: string[] = [];
    try {
      for (const client of [owner, other]) {
        const email = `pawport-multi-${randomUUID()}@example.com`,
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
      const h = await owner
        .from("households")
        .insert({ name: "Multi-pet test" })
        .select("id")
        .single();
      assert.ifError(h.error);
      const home = h.data!.id;
      const row = {
        household_id: home,
        name: "Photo pet",
        species: "Dog",
        breed: "Mixed",
        sex: "Unknown",
      };
      const p = await owner.from("pets").insert(row).select("id").single();
      assert.ifError(p.error);
      const pet = p.data!.id;
      pets.push(pet);
      assert.equal(
        (await other.from("pets").select("id").eq("id", pet)).data?.length,
        0,
      );
      assert.ok((await other.from("pets").insert(row)).error);
      assert.equal(
        (
          await other
            .from("pets")
            .update({ name: "Forged" })
            .eq("id", pet)
            .select("id")
        ).data?.length,
        0,
      );
      const filler = await owner
        .from("pets")
        .insert(
          Array.from({ length: 18 }, (_, i) => ({
            ...row,
            name: `Pet ${i + 2}`,
          })),
        )
        .select("id");
      assert.ifError(filler.error);
      pets.push(...filler.data!.map((p) => p.id));
      const competing = await Promise.all([
        owner
          .from("pets")
          .insert({ ...row, name: "Race A" })
          .select("id")
          .single(),
        owner
          .from("pets")
          .insert({ ...row, name: "Race B" })
          .select("id")
          .single(),
      ]);
      assert.equal(competing.filter((r) => !r.error).length, 1);
      pets.push(...competing.flatMap((r) => (r.data ? [r.data.id] : [])));
      assert.equal(
        (
          await owner
            .from("pets")
            .select("id", { count: "exact", head: true })
            .eq("household_id", home)
        ).count,
        20,
      );
      // Real PNG bytes; Storage independently enforces MIME and byte limits.
      const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6gGQAAAAASUVORK5CYII=",
        "base64",
      );
      const prep = await owner.rpc("prepare_pet_photo", {
        p_pet: pet,
        p_name: "face.png",
        p_mime: "image/png",
        p_size: bytes.length,
      });
      assert.ifError(prep.error);
      paths.push(prep.data.path);
      assert.ok(
        (
          await other.storage
            .from("pet-photos")
            .upload(prep.data.path, bytes, { contentType: "image/png" })
        ).error,
      );
      assert.ok(
        (
          await anon.storage
            .from("pet-photos")
            .upload(prep.data.path, bytes, { contentType: "image/png" })
        ).error,
      );
      assert.ok(
        (
          await owner.storage
            .from("pet-photos")
            .upload(prep.data.path, bytes, { contentType: "image/svg+xml" })
        ).error,
      );
      assert.ok(
        (
          await owner.storage
            .from("pet-photos")
            .upload(prep.data.path, new Uint8Array(3145729), {
              contentType: "image/png",
            })
        ).error,
      );
      assert.ifError(
        (
          await owner.storage
            .from("pet-photos")
            .upload(prep.data.path, bytes, { contentType: "image/png" })
        ).error,
      );
      assert.ifError(
        (await owner.rpc("finalize_pet_photo", { p_photo: prep.data.id }))
          .error,
      );
      assert.ifError(
        (await owner.storage.from("pet-photos").download(prep.data.path)).error,
      );
      assert.ok(
        (await other.storage.from("pet-photos").download(prep.data.path)).error,
      );
      assert.ok(
        (await anon.storage.from("pet-photos").download(prep.data.path)).error,
      );
      assert.ok(
        (
          await owner.storage
            .from("pet-photos")
            .upload(prep.data.path, bytes, {
              contentType: "image/png",
              upsert: true,
            })
        ).error,
      );
      // Failed delete must leave the current object intact (Storage can return empty success).
      await owner.storage.from("pet-photos").remove([prep.data.path]);
      assert.ifError(
        (await owner.storage.from("pet-photos").download(prep.data.path)).error,
      );
      const replacement = await owner.rpc("prepare_pet_photo", {
        p_pet: pet,
        p_name: "new.png",
        p_mime: "image/png",
        p_size: bytes.length,
      });
      assert.ifError(replacement.error);
      paths.push(replacement.data.path);
      assert.ifError(
        (
          await owner.storage
            .from("pet-photos")
            .upload(replacement.data.path, bytes, { contentType: "image/png" })
        ).error,
      );
      const finalized = await owner.rpc("finalize_pet_photo", {
        p_photo: replacement.data.id,
      });
      assert.ifError(finalized.error);
      assert.equal(finalized.data.previous_path, prep.data.path);
      assert.ifError(
        (await owner.storage.from("pet-photos").remove([prep.data.path])).error,
      );
      assert.ok(
        (await owner.storage.from("pet-photos").download(prep.data.path)).error,
      );
      assert.ifError(
        (await owner.storage.from("pet-photos").download(replacement.data.path))
          .error,
      );
      assert.ok(
        (await owner.rpc("finalize_pet_photo", { p_photo: prep.data.id }))
          .error,
      );
    } finally {
      if (paths.length)
        assert.ifError(
          (await admin.storage.from("pet-photos").remove(paths)).error,
        );
      if (pets.length)
        assert.ifError(
          (await admin.from("pets").update({ photo_id: null }).in("id", pets))
            .error,
        );
      for (const id of users)
        assert.ifError((await admin.auth.admin.deleteUser(id)).error);
    }
  },
);
