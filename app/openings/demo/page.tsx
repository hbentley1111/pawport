import Link from "next/link";
import { notFound } from "next/navigation";
import { ownerSession } from "@/lib/pet-data";
import { OwnerAppFrame } from "@/components/owner-app-frame";
import { schedulingAdapter } from "@/lib/scheduling/registry";
import { matchAvailability } from "@/lib/openings/matcher";
import { MatchOverview } from "@/components/openings/presentation";
import type { WatchSummary } from "@/lib/openings/schema";
export const dynamic = "force-dynamic";
export default async function Demo() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.PAWPORT_ENABLE_MOCK_SCHEDULING !== "true" ||
    process.env.VERCEL_ENV === "production"
  )
    notFound();
  await ownerSession();
  const c = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    externalSystem: "mock" as const,
  };
  const adapter = schedulingAdapter(c.externalSystem, c.id);
  const w: WatchSummary = {
    id: "demo-watch",
    pet_id: "demo-pet",
    pet_name: "Demo pet",
    appointment_id: "demo-appointment",
    provider_name: "Demo Scheduling System",
    system: "mock",
    google_place_id: null,
    appointment_type: "veterinary",
    earliest_date: "2027-10-01",
    latest_date: "2027-10-19",
    earliest_time: null,
    latest_time: null,
    allowed_weekdays: null,
    current_appointment_start: "2027-10-20T12:00:00Z",
    time_zone: "UTC",
    status: "active",
    last_checked_at: null,
    last_match_at: null,
    expires_at: "2027-10-20T12:00:00Z",
    matches: [],
  };
  const slots = await adapter.listAvailability!(c, {
    type: "veterinary",
    from: "2027-10-01T00:00:00Z",
    to: "2027-10-19T23:59:00Z",
  });
  const matches = matchAvailability(
    { ...w, connection_id: c.id },
    slots,
    Date.parse("2027-10-01T00:00:00Z"),
  );
  return (
    <OwnerAppFrame>
      <main className="care-page">
        <Link href="/openings">← Openings</Link>
        <h1>Demo availability.</h1>
        <p className="privacy-note">
          Fictional slots with a fixed demo clock. Nothing is saved, reserved,
          booked, or sent.
        </p>
        {matches.map((s, i) => (
          <section className="account-card" key={i}>
            <MatchOverview
              watch={w}
              match={{
                id: "demo",
                starts_at: s.startsAt,
                ends_at: s.endsAt,
                last_seen_at: "2027-10-01T00:00:00Z",
                status: "available",
              }}
            />
          </section>
        ))}
      </main>
    </OwnerAppFrame>
  );
}
