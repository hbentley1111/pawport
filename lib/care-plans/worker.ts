import "server-only";
// Supply a restricted pawport_care_worker SQL/RPC transport from a future trusted worker.
// This is deliberately not a public endpoint or a browser/server action.
export async function processCareReminders(
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>,
  now = new Date(),
  limit = 200,
) {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500
  )
    throw new Error("Invalid care worker bounds");
  const result = await rpc("process_care_reminders", {
    p_now: now.toISOString(),
    p_limit: limit,
  });
  if (result.error) throw new Error("Care reminder processing unavailable");
  return Number(result.data);
}
