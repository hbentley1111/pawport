import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ownerSession } from "@/lib/pet-data";
import { profileEditor } from "@/lib/business-profiles/data";
import { ServicesShell } from "@/components/services/shell";
import {
  OrganizationForm,
  LogoUpload,
} from "@/components/business-profiles/forms";
export const dynamic = "force-dynamic";
export default async function Organization({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { db } = await ownerSession();
  const { organizationId } = await params;
  const e = await profileEditor(db, organizationId);
  if (!e) notFound();
  return (
    <ServicesShell>
      <Link href="/provider/businesses">← Business profiles</Link>
      <header className="business-heading">
        <h1>{e.name}</h1>
        {e.canEdit && (
          <Link href={`/provider/businesses/${e.id}/team`}>Manage team</Link>
        )}
        <p>
          Business-provided information ·{" "}
          {e.canEdit ? "Owner / admin editor" : "Read-only access"}
        </p>
      </header>
      <div className="business-profile-grid">
        <section className="business-panel">
          <h2>Organization profile</h2>
          {e.canEdit ? (
            <OrganizationForm editor={e} />
          ) : (
            <>
              <p>{e.tagline}</p>
              <p className="business-text">{e.description}</p>
              <p>{e.public_email}</p>
              <p>{e.public_phone}</p>
              <p>{e.website_url}</p>
            </>
          )}
        </section>
        <div>
          <section className="business-panel">
            <h2>Logo</h2>
            {e.logoUrl && (
              <Image
                src={e.logoUrl}
                alt={`${e.name} logo`}
                width={112}
                height={112}
                unoptimized
              />
            )}
            {e.canEdit && <LogoUpload org={e.id} />}
          </section>
          <section className="business-panel">
            <h2>Locations</h2>
            <ul className="business-services">
              {e.locations.map((l) => (
                <li key={l.id}>
                  {l.status === "active" ? (
                    <Link
                      href={`/provider/businesses/${e.id}/locations/${l.id}`}
                    >
                      {l.fields.display_name || e.name} · {l.profileStatus}
                    </Link>
                  ) : (
                    <span>{l.fields.display_name || e.name} · Suspended</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </ServicesShell>
  );
}
