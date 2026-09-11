import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import ts from "typescript";
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
test("client import graph cannot reach Google credentials or server-only Google transport", () => {
  const sources = [...files("components"), ...files("app")].filter((p) =>
    /\.tsx?$/.test(p),
  );
  const visited = new Set<string>();
  function visit(file: string) {
    file = resolve(file);
    if (visited.has(file)) return;
    visited.add(file);
    const text = readFileSync(file, "utf8");
    if (/^\s*["']use server["']/.test(text)) return; // Next.js action references are an explicit server boundary.
    assert.doesNotMatch(
      text,
      /import\s+["']server-only["']|process\.env\.GOOGLE_MAPS_API_KEY|places\.googleapis\.com|maps\.googleapis\.com/,
    );
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const node of tree.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier) ||
        node.importClause?.isTypeOnly
      )
        continue;
      const named = node.importClause?.namedBindings;
      if (
        named &&
        ts.isNamedImports(named) &&
        !node.importClause?.name &&
        named.elements.every((e) => e.isTypeOnly)
      )
        continue;
      const spec = node.moduleSpecifier.text;
      if (!spec.startsWith(".") && !spec.startsWith("@/")) continue;
      const base = spec.startsWith("@/")
        ? resolve(spec.slice(2))
        : resolve(dirname(file), spec);
      const target = [
        base + ".ts",
        base + ".tsx",
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ].find(existsSync);
      if (target) visit(target);
    }
  }
  for (const file of sources)
    if (/^\s*["']use client["']/.test(readFileSync(file, "utf8"))) visit(file);
  assert.doesNotMatch(
    readFileSync("next.config.ts", "utf8"),
    /GOOGLE_MAPS_API_KEY|NEXT_PUBLIC_GOOGLE/,
  );
  assert.ok(visited.size > 10);
});
test(
  "built browser assets do not contain Google key configuration or the build-test secret",
  { skip: !existsSync(".next/static") },
  () => {
    for (const file of files(".next/static").filter((p) =>
      /\.(js|json|map)$/.test(p),
    ))
      assert.doesNotMatch(
        readFileSync(file, "utf8"),
        /GOOGLE_MAPS_API_KEY|pawport-phase4-secret-sentinel/,
      );
  },
);
