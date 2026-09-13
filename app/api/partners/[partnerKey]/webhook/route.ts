import "server-only";
// No registered, authenticated commercial webhook adapters in Phase 10A.
// Fail before reading/storing a body. Future adapters require verified signatures,
// replay protection, normalization, bounds and the privileged runtime guard.
export async function POST() {
  return Response.json(
    { error: "Partner webhook unavailable" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
