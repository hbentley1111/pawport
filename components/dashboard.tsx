import { PetPreventiveCard } from "./preventive-care/client";
import { RecentActivity } from "./timeline/presentation";
import type { PetTimelineEvent } from "@/lib/timeline/schema";
import { CareComingUp } from "./care-plans/presentation";
import type { CarePlan } from "@/lib/care-plans/schema";
import { OpeningsSummary } from "./openings/presentation";
import type { WatchSummary } from "@/lib/openings/schema";
import { UpcomingCare } from "./care/cards";
import type { Appointment } from "@/lib/care/schema";
import { Brand } from "./brand";
import { AppFrame } from "./app-frame";
import { PetAvatar } from "./pet-avatar";
import { PetNavigation } from "./pet-navigation";
import { TrustBadge } from "./trust-badge";
import Link from "next/link";
import {
  PawPrint,
  MapPin,
  LayoutDashboard,
  ShieldCheck,
  Heart,
  ArrowUpRight,
  Settings,
  ChevronDown,
  Plus,
  FileHeart,
  LockKeyhole,
  Check,
  CalendarDays,
  ArrowRight,
  CircleHelp,
  Sparkles,
} from "lucide-react";
import { ShareButton, VaccinationButton, RevokeButton } from "./forms";

import { formatDate, vaccinationStatus } from "@/lib/validation";
import type { Pet, Vaccination, SharePass } from "@/lib/types";
export { Brand } from "./brand";
export function Dashboard({
  pet,
  vaccinations,
  passes,
  household,
  demo,
  accountName = "Your account",
  appointments = null,
  openings = [],
  carePlans = null,
  recentActivity = null,
}: {
  pet: Pet;
  vaccinations: Vaccination[];
  passes: SharePass[];
  household: string;
  demo: boolean;
  accountName?: string;
  appointments?: Appointment[] | null;
  openings?: WatchSummary[];
  carePlans?: CarePlan[] | null;
  recentActivity?: PetTimelineEvent[] | null;
}) {
  const due = vaccinations.filter((v) =>
    ["Due soon", "Overdue"].includes(vaccinationStatus(v.due_on)),
  );
  const next = [...vaccinations]
    .filter((v) => v.due_on)
    .sort((a, b) => a.due_on!.localeCompare(b.due_on!))[0];
  return (
    <AppFrame enabled={!demo}>
      <div className="app-shell">
        {demo && (
          <aside className="sidebar">
            <Brand />
            <div className="household">
              <div className="household-avatar">{household.slice(0, 1)}</div>
              <div>
                <strong>{household}</strong>
                <small>Your little family</small>
              </div>
              <ChevronDown size={15} />
            </div>
            <p className="nav-label">WORKSPACE</p>
            <nav>
              <Link href="/" className="nav-item active">
                <LayoutDashboard size={19} />
                Your household
                <span className="nav-active-dot" />
              </Link>
              <a href="#passport" className="nav-item">
                <PawPrint size={19} />
                Pet passport
              </a>
              <Link
                href={demo ? "/login" : `/pets/${pet.id}/records`}
                className="nav-item"
              >
                <FileHeart size={19} />
                Health records
              </Link>
              <a href="#sharing" className="nav-item">
                <ShieldCheck size={19} />
                Share passes
              </a>
              <Link href="/services" className="nav-item">
                <MapPin size={19} /> Local Services
              </Link>
            </nav>
            <div className="sidebar-bottom">
              <div className="care-note">
                <span className="care-icon">
                  <Heart size={20} />
                </span>
                <h3>For the love of paws.</h3>
                <p>
                  Less paperwork.
                  <br />
                  More life together.
                </p>
                <span className="tiny-paws">
                  <PawPrint size={43} />
                </span>
              </div>
              <Link href="/help" className="nav-item">
                <CircleHelp size={18} />
                Help & privacy
                <ArrowUpRight size={14} />
              </Link>
              {demo ? (
                <Link href="/login" className="profile">
                  <span className="profile-avatar">A</span>
                  <span>
                    <strong>Alex Miller</strong>
                    <small>Preview household</small>
                  </span>
                  <ArrowUpRight size={17} />
                </Link>
              ) : (
                <Link href="/account" className="profile">
                  <span className="profile-avatar">
                    {accountName.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{accountName}</strong>
                    <small>Account settings</small>
                  </span>
                  <Settings size={17} />
                </Link>
              )}
            </div>
          </aside>
        )}
        <div className="main-wrap">
          {demo && (
            <header className="topbar">
              <div className="mobile-brand">
                <Brand />
              </div>
              <span className="breadcrumb">
                Your workspace <span>/</span> <strong>Overview</strong>
              </span>
              <div className="topbar-actions">
                <Link className="account-top-link" href="/services">
                  <MapPin size={16} /> Services
                </Link>
                <span className="private-label">
                  <LockKeyhole size={13} /> Private by default
                </span>
                <Link
                  className="account-top-link"
                  href={demo ? "/login" : "/account"}
                >
                  <Settings size={16} /> Account
                </Link>
              </div>
            </header>
          )}
          <main className="dashboard">
            {demo && (
              <div className="preview-banner">
                <span>
                  <Sparkles size={14} /> You’re exploring a sample passport.
                </span>
                <Link href="/login">
                  Make it yours <ArrowRight size={14} />
                </Link>
              </div>
            )}
            <div className="page-heading">
              <div>
                <p className="eyebrow">A LITTLE ORGANIZATION. A LOT OF LOVE.</p>
                <h1>
                  Their best life, together<span>.</span>
                </h1>
                <p>
                  Everything you need to care for {pet.name}, in one happy
                  place.
                </p>
              </div>
              <span className="today">
                <CalendarDays size={15} />
                {formatDate(new Date().toISOString())}
              </span>
            </div>
            {!demo && (
              <>
                <div className="pet-context">
                  <Link href="/">← Your household</Link>
                  <Link href="/pets/new" className="button secondary small">
                    <Plus size={15} /> Add pet
                  </Link>
                </div>
                <PetNavigation petId={pet.id} />
                <PetPreventiveCard petId={pet.id} petName={pet.name} />
                <CareComingUp
                  plans={carePlans}
                  pets={[pet]}
                  petId={pet.id}
                  now={new Date().getTime()}
                />
                <RecentActivity events={recentActivity} petId={pet.id} />
                <OpeningsSummary watches={openings} petId={pet.id} />
                <UpcomingCare
                  appointments={appointments}
                  pets={[pet]}
                  petId={pet.id}
                  now={new Date().getTime()}
                />
              </>
            )}
            <div className="overview-grid">
              <section className="passport-card" id="passport">
                <div className="passport-top">
                  <span>
                    <PawPrint size={15} /> PET HEALTH PASSPORT
                  </span>
                  <span className="passport-private">
                    <LockKeyhole size={12} /> PRIVATE
                  </span>
                </div>
                <div className="pet-identity">
                  <PetAvatar pet={pet} />
                  <div>
                    <span className="pet-label">
                      YOUR VERY GOOD{" "}
                      {pet.species === "Dog"
                        ? "DOG"
                        : pet.species === "Cat"
                          ? "CAT"
                          : "COMPANION"}
                    </span>
                    <h2>
                      {pet.name}
                      <span className="pet-name-dot">✦</span>
                    </h2>
                    <p>
                      {pet.breed} <span>·</span> {pet.sex}
                    </p>
                  </div>
                  <div className="passport-stamp">
                    <ShieldCheck size={30} />
                    <span>
                      MADE FOR
                      <br />A LIFETIME
                    </span>
                  </div>
                </div>
                <div className="pet-details">
                  <div>
                    <span>DATE OF BIRTH</span>
                    <strong>{formatDate(pet.birth_date)}</strong>
                  </div>
                  <div>
                    <span>SPECIES</span>
                    <strong>{pet.species}</strong>
                  </div>
                  <div>
                    <span>MICROCHIP NUMBER</span>
                    <strong>{pet.microchip || "Not recorded"}</strong>
                  </div>
                </div>
                <div className="passport-bottom">
                  <span>
                    <span className="live-dot" /> One pet. One living record.
                  </span>
                  {!demo && (
                    <Link href={`/pets/${pet.id}/edit`}>
                      Edit profile <ArrowUpRight size={12} />
                    </Link>
                  )}
                </div>
              </section>
              <section className="share-card" id="sharing">
                <div className="share-card-icon">
                  <ShieldCheck size={25} />
                </div>
                <span className="eyebrow">READY WHEN LIFE HAPPENS</span>
                <h2>
                  One passport.
                  <br />
                  Wherever they go.
                </h2>
                <p>
                  At the vet, with the sitter, or off on an adventure. Share the
                  essentials, safely.
                </p>
                <ShareButton petId={pet.id} demo={demo} />
                <span className="share-foot">
                  <LockKeyhole size={12} /> Time-limited. Always in your
                  control.
                </span>
              </section>
            </div>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-icon green">
                  <FileHeart size={21} />
                </span>
                <div>
                  <span>Vaccinations recorded</span>
                  <strong>
                    {vaccinations.length}
                    <small>in their passport</small>
                  </strong>
                </div>
                <Check size={17} className="stat-trailing" />
              </div>
              <div className="stat">
                <span className="stat-icon amber">
                  <CalendarDays size={21} />
                </span>
                <div>
                  <span>Needs a little attention</span>
                  <strong>
                    {due.length}
                    <small>
                      {due.length === 1
                        ? "upcoming or overdue record"
                        : "upcoming or overdue records"}
                    </small>
                  </strong>
                </div>
              </div>
              <div className="stat">
                <span className="stat-icon lilac">
                  <ShieldCheck size={21} />
                </span>
                <div>
                  <span>Active share passes</span>
                  <strong>
                    {passes.length}
                    <small>
                      {passes.length
                        ? "temporary access links"
                        : "only you have access"}
                    </small>
                  </strong>
                </div>
              </div>
            </div>
            <section className="records-section" id="vaccinations">
              <div className="section-heading">
                <div>
                  <h2>
                    A healthy paper trail
                    <span className="count-pill">{vaccinations.length}</span>
                  </h2>
                  <p>The little records that make a big difference.</p>
                </div>
                <div className="record-header-actions">
                  <Link
                    className="document-link"
                    href={demo ? "/login" : `/pets/${pet.id}/records`}
                  >
                    Health records
                  </Link>
                  <VaccinationButton petId={pet.id} demo={demo} />
                </div>
              </div>
              <div className="records-table-wrap">
                <table className="records-table">
                  <thead>
                    <tr>
                      <th>VACCINATION</th>
                      <th>ADMINISTERED</th>
                      <th>NEXT DUE</th>
                      <th>NEXT DUE STATUS</th>
                      <th>TRUST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vaccinations.map((v) => {
                      const status = vaccinationStatus(v.due_on);
                      return (
                        <tr key={v.id}>
                          <td>
                            <div className="vaccine-name">
                              <span className="vaccine-icon">
                                <Plus size={18} />
                              </span>
                              <div>
                                <strong>{v.name}</strong>
                                <small>{v.clinic}</small>
                              </div>
                            </div>
                          </td>
                          <td>{formatDate(v.administered_on)}</td>
                          <td>{formatDate(v.due_on)}</td>
                          <td>
                            <span
                              className={`status ${status === "Overdue" ? "overdue" : status === "Due soon" ? "due" : "recorded"}`}
                            >
                              <span />
                              {status}
                            </span>
                          </td>
                          <td>
                            <TrustBadge trust={v} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {vaccinations.length === 0 && (
                  <div className="empty-state">
                    <FileHeart size={32} />
                    <h3>Their story starts here.</h3>
                    <p>
                      Add the first vaccination from your pet’s veterinary
                      record.
                    </p>
                  </div>
                )}
                <div className="records-footer">
                  <ShieldCheck size={14} /> Each record shows its source and
                  verification status.
                </div>
              </div>
            </section>
            <div className="bottom-grid">
              <section className="gentle-reminder">
                <span className="reminder-icon">
                  <Heart size={22} />
                </span>
                <div>
                  <p className="eyebrow">A LITTLE HEADS-UP</p>
                  <h3>
                    {next
                      ? `${next.name} is next on the calendar.`
                      : "Good care starts with a record."}
                  </h3>
                  <p>
                    {next
                      ? `Next recorded due date: ${formatDate(next.due_on)}. Your vet can confirm the right schedule.`
                      : "Keep vaccination dates together so they’re ready when you need them."}
                  </p>
                </div>
                <CalendarDays size={32} className="reminder-decoration" />
              </section>
              <section className="privacy-card">
                <LockKeyhole size={20} />
                <div>
                  <h3>Their details. Your say.</h3>
                  <p>Private by default. Shared only with a pass you create.</p>
                </div>
              </section>
            </div>
            {passes.length > 0 && (
              <section className="active-passes">
                <h2>Active share passes</h2>
                <p className="muted">
                  Revoke a pass to end access immediately.
                </p>
                {passes.map((pass) => (
                  <RevokeButton key={pass.id} pass={pass} petId={pet.id} />
                ))}
              </section>
            )}
            <footer className="dashboard-footer">
              <span>
                <PawPrint size={14} /> A little peace of mind, for every paw.
              </span>
              <span>Made for the ones you love.</span>
            </footer>
          </main>
        </div>
      </div>
    </AppFrame>
  );
}
