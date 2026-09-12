import "server-only";
import { processCareReminders } from "@/lib/care-plans/worker";
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
export async function processAppointmentReminders(
  rpc: Rpc,
  now = new Date(),
  limit = 200,
) {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 500
  )
    throw new Error("Invalid reminder worker bounds");
  const r = await rpc("process_appointment_reminders", {
    p_now: now.toISOString(),
    p_limit: limit,
  });
  if (r.error) throw new Error("Appointment reminders unavailable");
  return Number(r.data);
}
// Independent restricted transports: orchestration does not combine role privileges.
export function runOwnerNotificationJobs(
  transports: {
    care: Rpc;
    appointments: Rpc;
    availability?: () => Promise<unknown>;
  },
  now = new Date(),
) {
  return Promise.allSettled([
    processCareReminders(transports.care, now),
    processAppointmentReminders(transports.appointments, now),
    ...(transports.availability ? [transports.availability()] : []),
  ]);
}
