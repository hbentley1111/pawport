import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Brand } from "../components/brand";
import { SourceBadge } from "../components/preventive-care/presentation";
import { brandLabel, preventiveExplanation } from "../lib/brand";

test("legacy record labels render the new brand without changing trust or source values", () => {
  const html = renderToStaticMarkup(
    React.createElement(SourceBadge, {
      item: {
        sourceType: "pawport_guidance",
        sourceLabel: "Pawport preventive-care guidance",
      },
    }),
  );
  assert.match(html, /PetThread preventive-care guidance/);
  assert.doesNotMatch(html, /Pawport|Vet verified/);
  assert.equal(
    brandLabel("Confirmed through Pawport"),
    "Confirmed through PetThread",
  );
  assert.equal(brandLabel("pawport_to_partner"), "PetThread to partner");
  assert.equal(brandLabel("partner_to_pawport"), "Partner to PetThread");
  assert.equal(brandLabel("Vet verified"), "Vet verified");
  assert.equal(brandLabel("My Pawport note"), "My Pawport note");
  assert.match(
    preventiveExplanation("Pawport shows this general topic for dogs."),
    /^PetThread/,
  );
});

test("wordmark, metadata and original hero retain safe links and identity", () => {
  const html = renderToStaticMarkup(React.createElement(Brand));
  assert.match(html, /aria-label="PetThread home"/);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /pawport/i);
  const meta = readFileSync("app/layout.tsx", "utf8");
  assert.match(meta, /PetThread \| Everything your pet needs, connected\./);
  assert.match(meta, /applicationName: "PetThread"/);
  assert.match(meta, /openGraph:/);
  assert.match(meta, /twitter:/);
  assert.equal(
    createHash("sha256")
      .update(readFileSync("public/pawport-dog-cat-room.png"))
      .digest("hex"),
    "2913299d0e0c6c11be7bbab0ea962343adb2548b51b353454d1181c8ff3dffc2",
  );
});

test("application brand inventory allows only documented compatibility tokens", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  const allowed =
    /PAWPORT_[A-Z_]+|pawport:notifications-updated|pawport-dog-cat-room\.png|pawport_guidance|pawport_live|pawport_to_partner|partner_to_pawport|pawport_care_worker|pawport_scheduling_worker|pawportType|PawportTodayItem|getPawportToday|my_pawport_today|pawport-care:|@pawport|"pawport"/g;
  for (const f of [
    ...walk("app"),
    ...walk("components"),
    ...walk("lib"),
    ...walk("supabase/functions"),
  ]) {
    if (!/\.(tsx?|css)$/.test(f) || f === "lib/brand.ts") continue;
    let s = readFileSync(f, "utf8").replace(allowed, "");
    if (f === "lib/services/schema.ts")
      s = s.replace('reviewer: "Pawport Member"', 'reviewer: "legacy label"');
    assert.doesNotMatch(s, /pawport|paw port/i, f);
  }
  assert.match(
    readFileSync("components/services/detail.tsx", "utf8"),
    /<strong>PetThread Member<\/strong>/,
  );
});
