import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  AppNavigationLinks,
  activeAppSection,
} from "../components/app-navigation-links";
import { HouseholdQuickAccess } from "../components/household-quick-access";
import { Brand } from "../components/brand";
test("desktop and mobile navigation expose the desktop destinations and five mobile destinations with text labels", () => {
  for (const mobile of [false, true]) {
    const html = renderToStaticMarkup(
      createElement(AppNavigationLinks, {
        pathname: "/services/place",
        mobile,
      }),
    );
    for (const label of mobile
      ? ["Home", "Pets", "Care", "Services", "Account"]
      : ["Home", "Pets", "Records", "Care", "Services", "Account"])
      assert.match(html, new RegExp(`<span>${label}</span>`));
    for (const href of mobile
      ? ["/", "/appointments", "/services", "/account"]
      : ["/", "/records", "/appointments", "/services", "/account"])
      assert.ok(html.includes(`href="${href}"`));
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assert.match(
      html,
      /<a(?=[^>]*href="\/services")(?=[^>]*aria-current="page")[^>]*>/,
    );
    assert.match(html, /aria-label="(?:Mobile )?Pawport navigation"/);
    assert.doesNotMatch(html, /Vaccinations|Share Passport/);
    assert.equal((html.match(/<a /g) || []).length, mobile ? 5 : 6);
    if (mobile) assert.doesNotMatch(html, /href="\/records"/);
  }
  assert.match(
    renderToStaticMarkup(createElement(Brand)),
    /<a(?=[^>]*href="\/")(?=[^>]*class="brand")(?=[^>]*aria-label="Pawport home")[^>]*>/,
  );
});
test("route-derived selection distinguishes home, pet profiles, records and detail pages", () => {
  for (const [path, section] of [
    ["/", "Home"],
    ["/pets/new", "Pets"],
    ["/pets/pet-a", "Pets"],
    ["/pets/pet-a/edit", "Pets"],
    ["/pets/pet-a/records", "Records"],
    ["/records", "Records"],
    ["/services", "Services"],
    ["/services/place-a", "Services"],
    ["/account", "Account"],
    ["/appointments", "Care"],
    ["/appointments/new", "Care"],
    ["/login", null],
    ["/provider", null],
  ])
    assert.equal(activeAppSection(path!), section);
});
test("quick access keeps the four non-pet-specific actions directly reachable", () => {
  const html = renderToStaticMarkup(createElement(HouseholdQuickAccess));
  assert.match(html, /Quick access/);
  for (const [title, href] of [
    ["Health Records", "/records"],
    ["Local Services", "/services"],
    ["Add Pet", "/pets/new"],
    ["Account", "/account"],
  ]) {
    assert.ok(html.includes(`href="${href}"`));
    assert.ok(html.includes(`<strong>${title}</strong>`));
  }
  assert.equal((html.match(/<small>/g) || []).length, 4);
});
test("auth and provider routes stay outside the owner navigation and routing decisions remain intact", () => {
  for (const file of [
    "app/layout.tsx",
    "app/login/page.tsx",
    "app/forgot-password/page.tsx",
    "app/auth/reset-password/page.tsx",
    "app/auth/confirm/route.ts",
    "app/provider/page.tsx",
    "app/onboarding/page.tsx",
  ])
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /AppFrame|AppNavigation|OwnerAppFrame/,
    );
  const home = readFileSync("app/page.tsx", "utf8");
  assert.match(home, /memberships\?\.length\) redirect\("\/provider"\)/);
  assert.match(home, /pets.length === 1\) return <PetDashboard/);
  const records = readFileSync("app/records/page.tsx", "utf8");
  assert.match(
    records,
    /pets.length === 1\) redirect\(`\/pets\/\$\{pets\[0\].id\}\/records`\)/,
  );
  const frame = readFileSync("components/owner-app-frame.tsx", "utf8");
  assert.match(frame, /auth.getUser\(\)/);
  assert.match(frame, /\.eq\("owner_id", user.id\)/);
  assert.match(frame, /if \(!error && household\)/);
});
