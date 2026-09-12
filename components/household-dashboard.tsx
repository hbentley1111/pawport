import { OpeningsSummary } from "./openings/presentation";
import type { WatchSummary } from "@/lib/openings/schema";
import { UpcomingCare } from "./care/cards";
import type { Appointment } from "@/lib/care/schema";
import Link from "next/link";
import { ArrowUpRight, Heart, Plus, ShieldCheck } from "lucide-react";
import { AppFrame } from "./app-frame";
import { HouseholdQuickAccess } from "./household-quick-access";
import { PetAvatar } from "./pet-avatar";
import { petSummary, MAX_PETS } from "@/lib/pets";
import { formatDate } from "@/lib/validation";
import type { Pet, Vaccination } from "@/lib/types";
export function HouseholdDashboard({
  household,
  pets,
  vaccinations,
  recordsMode = false,
  appointments = null,
  openings = [],
}: {
  household: string;
  pets: Pet[];
  vaccinations: Vaccination[];
  recordsMode?: boolean;
  appointments?: Appointment[] | null;
  openings?: WatchSummary[];
}) {
  return (
    <AppFrame>
      <main className="household-page">
        <section className="family-heading">
          <div>
            <p className="eyebrow">{household} · YOUR LITTLE FAMILY</p>
            <h1>
              Every personality.
              <br />
              One happy home<span>.</span>
            </h1>
            <p className="muted">
              {recordsMode
                ? "Choose a pet to open their private health records."
                : "Their records, their little details, and a little more peace of mind."}
            </p>
          </div>
          <div className="family-emblem">
            <Heart size={42} strokeWidth={1.2} />
            <span>
              ALL YOUR LOVE,
              <br />
              IN ONE PLACE
            </span>
          </div>
        </section>
        {!recordsMode && (
          <>
            <HouseholdQuickAccess />
            <OpeningsSummary watches={openings} />
            <UpcomingCare
              appointments={appointments}
              pets={pets}
              now={new Date().getTime()}
            />
          </>
        )}
        <div className="section-heading family-section">
          <div>
            <h2>
              Your companions <span className="count-pill">{pets.length}</span>
            </h2>
            <p>A passport as individual as they are.</p>
          </div>
          {pets.length < MAX_PETS ? (
            <Link href="/pets/new" className="button">
              <Plus size={16} /> Add pet
            </Link>
          ) : (
            <p className="muted">
              Your household has reached its 20-pet limit.
            </p>
          )}
        </div>
        <div className="pet-card-grid">
          {pets.map((pet) => {
            const records = vaccinations.filter((v) => v.pet_id === pet.id);
            const { attention, next } = petSummary(records);
            return (
              <Link
                className="companion-card"
                key={pet.id}
                href={`/pets/${pet.id}${recordsMode ? "/records" : ""}`}
                aria-label={`Open ${pet.name}’s ${recordsMode ? "health records" : "passport"}`}
              >
                <div className="companion-art">
                  <PetAvatar pet={pet} />
                  <span className="companion-species">{pet.species}</span>
                </div>
                <div className="companion-content">
                  <h2>
                    {pet.name}
                    <ArrowUpRight size={20} />
                  </h2>
                  <p className="muted">
                    {pet.breed} · {pet.sex}
                  </p>
                  <span className={`status ${attention ? "due" : "recorded"}`}>
                    <span />
                    {attention
                      ? `${attention} record${attention === 1 ? " needs" : "s need"} attention`
                      : records.length
                        ? "Records together"
                        : "Ready for their first record"}
                  </span>
                  <div className="companion-records">
                    <strong>
                      {records.length} vaccination
                      {records.length === 1 ? "" : "s"} recorded
                    </strong>
                    <p>
                      {next
                        ? `${next.name} · Due ${formatDate(next.due_on)}`
                        : "Add dates as their story grows."}
                    </p>
                  </div>
                  <span className="companion-open">
                    Open {recordsMode ? "health records" : "passport"}
                    <ArrowUpRight size={16} />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
        <p className="family-privacy">
          <ShieldCheck size={17} /> Each pet has their own records and share
          passes. Private by default.
        </p>
      </main>
    </AppFrame>
  );
}
