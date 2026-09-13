import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EnvironmentCredentialResolver,
  registeredPartnerAdapter,
  registeredWebhookAdapter,
  validatePartnerContext,
  requirePartnerExecution,
  safePartnerLog,
  type RuntimeContext,
} from "../supabase/functions/_shared/partners/runtime";
import { ConnectionStatus } from "../components/partners/presentation";
const context: RuntimeContext = {
  connectionId: "00000000-0000-4000-8000-000000000001",
  partnerKey: "test",
  environment: "sandbox",
  credentialRef: "PARTNER_TEST",
  contractValid: true,
  capabilities: ["partner.health.readiness"],
};
test("Environment resolver reads only dedicated names and strictly typed private material", () => {
  const reads: string[] = [];
  const resolver = new EnvironmentCredentialResolver((key) => {
    reads.push(key);
    return JSON.stringify({ kind: "api_key", apiKey: "fixture-secret" });
  });
  for (const ref of [
    "HOME",
    "NEXT_PUBLIC_KEY",
    "PARTNER_TEST/SECRET",
    "PARTNER_",
  ])
    assert.throws(() => resolver.resolve(ref));
  assert.equal(reads.length, 0);
  assert.equal(resolver.resolve("PARTNER_TEST").kind, "api_key");
  assert.deepEqual(reads, ["PAWPORT_PARTNER_PARTNER_TEST_CREDENTIALS"]);
  assert.throws(() =>
    new EnvironmentCredentialResolver(
      () => '{"kind":"api_key","apiKey":"x","extra":"x"}',
    ).resolve("PARTNER_TEST"),
  );
  assert.throws(() =>
    new EnvironmentCredentialResolver(() => undefined).resolve("PARTNER_TEST"),
  );
});
test("No registered commercial or webhook adapters; fake and production calls fail closed", async () => {
  assert.equal(registeredPartnerAdapter("ezyvet"), null);
  assert.equal(registeredWebhookAdapter("test"), null);
  const result = await validatePartnerContext(
    context,
    new EnvironmentCredentialResolver(() =>
      JSON.stringify({ kind: "api_key", apiKey: "fixture-secret" }),
    ),
  );
  assert.equal(result.success, false);
  assert.equal(result.error, "unsupported");
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|PARTNER_TEST/);
  await assert.rejects(
    requirePartnerExecution(
      context,
      "partner.health.readiness",
      async () => true,
      () => "true",
    ),
  );
  await assert.rejects(
    requirePartnerExecution(
      { ...context, environment: "production" },
      "partner.health.readiness",
      async () => true,
      () => "true",
    ),
  );
});
test("Validation checks credentials, capability coverage and environment before harmless adapter calls", async () => {
  let called = 0;
  const adapter = {
    key: "test",
    supportedCapabilities: ["partner.health.readiness"] as const,
    validateConnection: async () => {
      called++;
      return { success: true };
    },
    healthCheck: async () => "healthy" as const,
  };
  const resolver = new EnvironmentCredentialResolver(() =>
    JSON.stringify({ kind: "api_key", apiKey: "fixture-secret" }),
  );
  assert.equal(
    (await validatePartnerContext(context, resolver, () => adapter)).success,
    true,
  );
  assert.equal(called, 1);
  for (const c of [
    { ...context, environment: "production" as const },
    { ...context, contractValid: false },
    { ...context, capabilities: ["scheduling.appointment.book" as const] },
  ])
    assert.equal(
      (await validatePartnerContext(c, resolver, () => adapter)).success,
      false,
    );
  assert.equal(called, 1);
});
test("Allowlisted logging drops headers, tokens, request bodies and arbitrary endpoints", () => {
  const safe = safePartnerLog({
    partnerKey: "ezyvet",
    connectionId: context.connectionId,
    capability: "scheduling.appointment.book",
    method: "POST",
    endpoint: "appointment_book",
    status: 200,
    durationMs: 50,
    Authorization: "secret",
    client_secret: "secret",
    access_token: "secret",
    refresh_token: "secret",
    cookie: "secret",
    api_key: "secret",
    body: { pet: "private" },
  });
  assert.doesNotMatch(
    JSON.stringify(safe),
    /secret|private|Authorization|cookie/,
  );
  assert.equal(safe.status, 200);
  assert.deepEqual(
    safePartnerLog({
      endpoint: "https://vendor/owner?id=secret",
      errorCode: "raw vendor private message",
    }),
    {},
  );
});
test("Operator health display exposes configuration state rather than references or secrets", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectionStatus, {
      connection: {
        environment: "sandbox",
        status: "pending",
        runtimeEnabled: false,
        credentialReferencePresent: true,
        credentialConfigured: false,
        health: "unvalidated",
        deadLetters: 0,
        unknownEvents: 0,
      },
    }),
  );
  assert.match(html, /Disabled/);
  assert.match(html, /Not confirmed/);
  assert.match(html, /not endorsement/);
  assert.doesNotMatch(html, /PARTNER_|credential_ref|verified partner/);
});
test("Edge boundary authenticates JWT; Next webhook has no vendor execution or raw payload storage", async () => {
  const edge = await readFile(
    "supabase/functions/partner-operations/index.ts",
    "utf8",
  );
  assert.match(edge, /auth\/v1\/user/);
  assert.match(edge, /2048/);
  assert.match(edge, /origins.has/);
  const route = await readFile(
    "app/api/partners/[partnerKey]/webhook/route.ts",
    "utf8",
  );
  assert.match(route, /404/);
  assert.doesNotMatch(route, /fetch\(|request.json|service_role/i);
  for (const file of [
    "components/partners/forms.tsx",
    "app/operator/partners/actions.ts",
    "lib/partners/data.ts",
  ])
    assert.doesNotMatch(
      await readFile(file, "utf8"),
      /SERVICE_ROLE|EnvironmentCredentialResolver|_shared\/partners\/runtime/,
    );
});

test("Credential resolution refuses a browser runtime", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  try {
    assert.throws(() =>
      new EnvironmentCredentialResolver(() =>
        JSON.stringify({ kind: "api_key", apiKey: "fixture-only" }),
      ).resolve("PARTNER_TEST"),
    );
  } finally {
    if (prior) Object.defineProperty(globalThis, "window", prior);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
