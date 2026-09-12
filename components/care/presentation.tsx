import Link from "next/link";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { PetAvatar } from "@/components/pet-avatar";
import type { Pet } from "@/lib/types";
import { careLabel, type Appointment } from "@/lib/care/schema";
import { careDate, careTime } from "@/lib/care/time";
import { CareDateTime } from "./local-time";
export function CareEntry({
  appointment: a,
  pet,
  zone,
}: {
  appointment: Appointment;
  pet: Pet;
  zone: string;
}) {
  return (
    <Link href={`/appointments/${a.id}`} className="care-card-link">
      <PetAvatar pet={pet} />
      <div className="care-card-copy">
        <span className="care-pet-name">
          {pet.name} · {careLabel(a.appointment_type)}
        </span>
        <h3>{a.title}</h3>
        <CareDateTime value={a.starts_at} zone={zone} />
        {a.ends_at && (
          <small>
            Ends {careDate(a.ends_at, zone)} · {careTime(a.ends_at, zone)}
          </small>
        )}
        {a.provider_name && <p>{a.provider_name}</p>}
        <span className={`care-status ${a.status}`}>{careLabel(a.status)}</span>
      </div>
      <ArrowUpRight size={17} aria-hidden="true" />
    </Link>
  );
}
export function CareEmpty({ petName }: { petName?: string }) {
  return (
    <div className="care-empty">
      <CalendarDays size={28} />
      <p>
        {petName
          ? `Nothing on the calendar for ${petName}.`
          : "No upcoming care yet."}
      </p>
    </div>
  );
}

export function CareCalendarEmpty({ past = false }: { past?: boolean }) {
  return (
    <div className="care-empty">
      <CalendarDays size={36} />
      <h2>
        {past ? "No past care to show." : "Your family calendar is clear."}
      </h2>
      <p>
        Record care you’ve arranged, and keep everyone’s next steps together.
      </p>
      <Link href="/appointments/new" className="button">
        Add appointment
      </Link>
    </div>
  );
}
