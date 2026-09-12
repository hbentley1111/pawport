import test from "node:test";
import assert from "node:assert/strict";
import {
  MockSchedulingAdapter,
  assertMockEnabled,
} from "../lib/scheduling/mock";
import { ingestWebhook, syncAppointments } from "../lib/scheduling/pipeline";
import { schedulingEventSchema } from "../lib/scheduling/schema";
test("mock guards, capabilities, isolated fixtures and authenticated webhook boundary", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    PAWPORT_ENABLE_MOCK_SCHEDULING: "true",
  });
  delete process.env.VERCEL_ENV;
  try {
    const c = { id: "one", externalSystem: "mock" as const };
    const adapter = new MockSchedulingAdapter(c.id, () => 1800000000000);
    assert.equal(await adapter.validateConnection(c), true);
    assert.equal(
      (await adapter.getConnectionMetadata(c)).label,
      "Demo Scheduling System",
    );
    assert.equal((await adapter.listExternalPets(c)).length, 1);
    assert.equal((await adapter.listAvailability(c)).length, 1);
    assert.equal(adapter.capabilities.supportsAppointmentCreate, false);
    assert.equal("createAppointment" in adapter, false);
    await assert.rejects(adapter.validateConnection({ ...c, id: "other" }));
    const a = await adapter.getAppointment(c, "demo-visit");
    assert.ok(a);
    a.title = "mutated copy";
    assert.notEqual(
      (await adapter.getAppointment(c, "demo-visit"))?.title,
      a.title,
    );
    const event = adapter.normalizeAppointment(a, "evt");
    let writes = 0;
    let healthWrites = 0;
    const store = {
      recordRun: async () => {},
      importEvent: async () => {
        writes++;
        return "processed";
      },
      recordFailure: async () => {
        healthWrites++;
      },
    };
    const signed = adapter.signDemoEvent(c, event);
    await assert.rejects(
      ingestWebhook(adapter, c, { ...signed, body: Buffer.from("{}") }, store),
    );
    await assert.rejects(
      ingestWebhook(
        adapter,
        c,
        adapter.signDemoEvent(c, event, 1700000000),
        store,
      ),
    );
    await assert.rejects(
      ingestWebhook(
        adapter,
        c,
        { ...signed, body: new Uint8Array(32769) },
        store,
      ),
    );
    await assert.rejects(
      ingestWebhook(adapter, c, { ...signed, headers: {} }, store),
    );
    assert.equal(writes, 0);
    assert.equal(healthWrites, 0);
    assert.throws(() => adapter.normalizeWebhookEvent({ event }), /Unverified/);
    assert.equal(await ingestWebhook(adapter, c, signed, store), "processed");
    assert.equal(writes, 1);
    const second = new MockSchedulingAdapter("two", () => 1800000000000);
    await assert.rejects(
      second.verifyWebhook({ id: "two", externalSystem: "mock" }, signed),
    );
    await adapter.cancelAppointment(c, "demo-visit");
    const version = (await adapter.getAppointment(c, "demo-visit"))?.version;
    await adapter.cancelAppointment(c, "demo-visit");
    assert.equal(
      (await adapter.getAppointment(c, "demo-visit"))?.version,
      version,
    );
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.throws(assertMockEnabled);
    assert.throws(() => new MockSchedulingAdapter(c.id));
    await assert.rejects(adapter.validateConnection(c));
    Object.assign(process.env, {
      NODE_ENV: "development",
      VERCEL_ENV: "production",
    });
    assert.throws(assertMockEnabled);
    delete process.env.VERCEL_ENV;
    delete process.env.PAWPORT_ENABLE_MOCK_SCHEDULING;
    assert.throws(assertMockEnabled);
  } finally {
    for (const k of [
      "NODE_ENV",
      "PAWPORT_ENABLE_MOCK_SCHEDULING",
      "VERCEL_ENV",
    ]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
test("normalization rejects ownership, Google content, invalid timestamps, types and unbounded identifiers", () => {
  const e = {
    event_id: "evt",
    kind: "upsert",
    external_id: "a",
    external_pet_id: "p",
    version: 1,
    title: "Care",
    appointment_type: "other",
    starts_at: "2027-01-01T12:00:00Z",
    ends_at: null,
    status: "scheduled",
  };
  assert.ok(schedulingEventSchema.safeParse(e).success);
  for (const patch of [
    { household_id: "spoof" },
    { provider_name: "Google name" },
    { starts_at: "2027-01-01T12:00:00" },
    { version: -1 },
    { version: 1.5 },
    { external_id: "x".repeat(256) },
    { appointment_type: "made_up" },
    { ends_at: "2026-01-01T00:00:00Z" },
  ])
    assert.equal(
      schedulingEventSchema.safeParse({ ...e, ...patch }).success,
      false,
    );
});
test("sync failure reports a bounded error and does not expose stack traces", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: "test",
    PAWPORT_ENABLE_MOCK_SCHEDULING: "true",
  });
  try {
    const adapter = new MockSchedulingAdapter("c");
    adapter.listAppointments = async () => {
      throw new Error("PRIVATE_VENDOR_PAYLOAD");
    };
    const codes: string[] = [];
    await assert.rejects(
      syncAppointments(
        adapter,
        { id: "c", externalSystem: "mock" },
        { from: "2027-01-01Z", to: "2028-01-01Z" },
        {
          recordRun: async () => {},
          importEvent: async () => "",
          recordFailure: async (_, code) => {
            codes.push(code);
          },
        },
      ),
      /Scheduling sync unavailable/,
    );
    assert.deepEqual(codes, ["unavailable"]);
  } finally {
    for (const k of ["NODE_ENV", "PAWPORT_ENABLE_MOCK_SCHEDULING"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
