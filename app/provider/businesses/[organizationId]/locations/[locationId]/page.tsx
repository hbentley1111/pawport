import Link from "next/link";
import { notFound } from "next/navigation";
import { ownerSession } from "@/lib/pet-data";
import { profileEditor } from "@/lib/business-profiles/data";
import { ServicesShell } from "@/components/services/shell";
import { BusinessProfile } from "@/components/business-profiles/presentation";
import {
  LocationForm,
  HoursForm,
  ServicesEditor,
  PublicationForm,
} from "@/components/business-profiles/forms";
export const dynamic = "force-dynamic";
export default async function Location({
  params,
}: {
  params: Promise<{ organizationId: string; locationId: string }>;
}) {
  const { db } = await ownerSession();
  const { organizationId, locationId } = await params;
  const e = await profileEditor(db, organizationId),
    l = e?.locations.find((l) => l.id === locationId && l.status === "active");
  if (!e || !l) notFound();
  return (
    <ServicesShell>
      <Link href={`/provider/businesses/${e.id}`}>← {e.name}</Link>
      <header className="business-heading">
        <h1>{l.fields.display_name || e.name}</h1>
        <p>Location profile · {l.profileStatus}</p>
      </header>
      {e.canEdit && (
        <div className="business-profile-grid">
          <div>
            <section className="business-panel">
              <h2>Location information</h2>
              <LocationForm org={e.id} location={l} />
            </section>
            <section className="business-panel">
              <h2>Services</h2>
              <ServicesEditor org={e.id} location={l} />
            </section>
          </div>
          <section className="business-panel">
            <h2>Hours</h2>
            <HoursForm org={e.id} location={l} />
          </section>
        </div>
      )}
      <section className="business-panel">
        <h2>Saved profile preview</h2>
        <p className="fine-print">Save each section to update this preview.</p>
        <BusinessProfile
          profile={{ ...l.preview, logoUrl: e.logoUrl }}
          preview
        />
      </section>
      {e.canEdit && (
        <section className="business-panel">
          <h2>Publication</h2>
          <PublicationForm org={e.id} location={l} />
        </section>
      )}
    </ServicesShell>
  );
}
