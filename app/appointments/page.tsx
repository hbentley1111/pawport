import Link from "next/link";
import { z } from "zod";
import { Plus, CalendarDays, FileHeart } from "lucide-react";
import { AppFrame } from "@/components/app-frame";
import { careContext, careFields } from "@/lib/care/data";
import {
  careTypes,
  careLabel,
  activeStatuses,
  type Appointment,
} from "@/lib/care/schema";
import { CareTimeline } from "@/components/care/cards";
export const dynamic = "force-dynamic";
export default async function Appointments({
  searchParams,
}: {
  searchParams: Promise<{
    pet?: string;
    type?: string;
    view?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const { db, pets, household } = await careContext();
  const pet =
    params.pet && pets.some((p) => p.id === params.pet) ? params.pet : "";
  const type = z.enum(careTypes).safeParse(params.type);
  const selectedType = type.success ? type.data : "";
  const view = params.view === "past" ? "past" : "upcoming";
  const parsedPage = z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .safeParse(params.page || 0);
  const page = parsedPage.success ? parsedPage.data : 0;
  const now = new Date().getTime();
  let query = db
    .from("appointments")
    .select(careFields, { count: "exact" })
    .eq("household_id", household.id);
  if (pet) query = query.eq("pet_id", pet);
  if (selectedType) query = query.eq("appointment_type", selectedType);
  if (view === "upcoming")
    query = query
      .in("status", activeStatuses)
      .gte("starts_at", new Date(now).toISOString());
  else
    query = query.or(
      `starts_at.lt.${new Date(now).toISOString()},status.in.(cancelled,completed)`,
    );
  const result = await query
    .order("starts_at", { ascending: view === "upcoming" })
    .order("id")
    .range(page * 30, page * 30 + 29);
  const url = (nextView: string, nextPage = 0) =>
    `/appointments?${new URLSearchParams({ view: nextView, pet, type: selectedType, page: String(nextPage) })}`;
  return (
    <AppFrame>
      <main className="care-page">
        <Link className="document-link" href="/appointments/requests">
          Appointment requests · View requests and time proposals
        </Link>
        <header className="care-heading">
          <div>
            <p className="eyebrow">ALL THEIR NEXT STEPS, TOGETHER</p>
            <h1>Your family care calendar.</h1>
            <p className="muted">A calm place for everything coming up.</p>
          </div>
          <Link
            href={`/appointments/new${pet ? `?pet=${pet}` : ""}`}
            className="button"
          >
            <Plus size={17} /> Add appointment
          </Link>
        </header>
        <div className="care-page-links">
          <Link className="document-link" href="/openings">
            Openings
          </Link>
          <Link className="document-link" href="/connections">
            Provider connections
          </Link>
          <Link className="document-link" href="/records">
            <FileHeart size={17} /> Health Records
          </Link>
          <Link className="document-link" href="/services">
            Find local care
          </Link>
        </div>
        <nav className="care-view-tabs" aria-label="Appointment history">
          <Link
            href={url("upcoming")}
            aria-current={view === "upcoming" ? "page" : undefined}
          >
            <CalendarDays size={17} /> Upcoming
          </Link>
          <Link
            href={url("past")}
            aria-current={view === "past" ? "page" : undefined}
          >
            Past & closed
          </Link>
        </nav>
        <form action="/appointments" className="care-filters">
          <input type="hidden" name="view" value={view} />
          <label className="field">
            <span>Pet</span>
            <select name="pet" defaultValue={pet} key={pet}>
              <option value="">All pets</option>
              {pets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Care type</span>
            <select name="type" defaultValue={selectedType} key={selectedType}>
              <option value="">All care types</option>
              {careTypes.map((t) => (
                <option key={t} value={t}>
                  {careLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary">Apply filters</button>
        </form>
        {result.error ? (
          <p role="status" className="feedback">
            Your care calendar is temporarily unavailable. Please try again
            later.
          </p>
        ) : (
          <CareTimeline
            appointments={(result.data || []) as unknown as Appointment[]}
            pets={pets}
            now={now}
            view={view}
          />
        )}
        {!result.error && (
          <div className="review-pagination">
            {page > 0 && (
              <Link href={url(view, page - 1)} className="button secondary">
                Previous
              </Link>
            )}
            {(result.count || 0) > (page + 1) * 30 && page < 100 && (
              <Link href={url(view, page + 1)} className="button secondary">
                Next appointments
              </Link>
            )}
          </div>
        )}
      </main>
    </AppFrame>
  );
}
