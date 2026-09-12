"use client";
import { CareCard } from "@/components/care/cards";
import { useLocalZone, useCareClock } from "@/components/care/local-time";
import type { Appointment } from "@/lib/care/schema";
import type { Pet } from "@/lib/types";
export function ExternalCare({
  appointment,
  pet,
  now,
}: {
  appointment: Appointment;
  pet: Pet;
  now: number;
}) {
  const zone = useLocalZone(),
    clock = useCareClock(now);
  return (
    <CareCard appointment={appointment} pet={pet} zone={zone} now={clock} />
  );
}
