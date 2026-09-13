import Link from "next/link";
import Image from "next/image";
import { Building2, MapPin, Clock, ArrowUpRight } from "lucide-react";
import {
  days,
  profileTrust,
  type PublicProfile,
  type Business,
} from "@/lib/business-profiles/schema";
export function BusinessProfile({
  profile: p,
  preview = false,
}: {
  profile: PublicProfile;
  preview?: boolean;
}) {
  const address = Object.values(p.address).filter(Boolean).join(", ");
  return (
    <article className="business-profile">
      {preview && (
        <p className="business-source">
          Private preview · Saved changes · Not a public draft link
        </p>
      )}
      <header className="business-profile-hero">
        <div className="business-logo">
          {p.logoUrl ? (
            <Image
              src={p.logoUrl}
              alt={`${p.businessName} logo`}
              width={112}
              height={112}
              unoptimized
            />
          ) : (
            <Building2 size={42} aria-hidden />
          )}
        </div>
        <div>
          <span className="business-source">Claimed on PetThread</span>
          <h1>{p.businessName}</h1>
          {p.locationName && <p>{p.locationName}</p>}
          {p.tagline && <p className="business-tagline">{p.tagline}</p>}
        </div>
      </header>
      <p className="fine-print">{profileTrust}</p>
      <div className="business-profile-grid">
        <div>
          {p.description && (
            <section className="business-panel">
              <h2>About</h2>
              <p className="business-text">{p.description}</p>
            </section>
          )}
          <section className="business-panel">
            <h2>Services</h2>
            {p.services.length ? (
              <ul className="business-services">
                {p.services.map((s) => (
                  <li key={s.id}>
                    <h3>{s.name}</h3>
                    {s.description && (
                      <p className="business-text">{s.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Services haven’t been added yet.</p>
            )}
          </section>
        </div>
        <div>
          <section className="business-panel">
            <h2>Business information</h2>
            <p className="business-source">{p.sourceLabel}</p>
            <div className="business-contact">
              {p.publicPhone && <p>{p.publicPhone}</p>}
              {p.publicEmail && (
                <a href={`mailto:${p.publicEmail}`}>{p.publicEmail}</a>
              )}
              {p.websiteUrl && (
                <a
                  href={p.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit website <ArrowUpRight size={15} aria-hidden />
                </a>
              )}
              {!p.publicPhone && !p.publicEmail && !p.websiteUrl && (
                <p>Contact information hasn’t been provided.</p>
              )}
            </div>
            {address && (
              <>
                <h3>
                  <MapPin size={17} aria-hidden /> Location
                </h3>
                <p>{address}</p>
              </>
            )}
          </section>
          <section className="business-panel">
            <h2>
              <Clock size={20} aria-hidden /> Hours
            </h2>
            {p.timeZone && (
              <p className="fine-print">Local time · {p.timeZone}</p>
            )}
            {p.hoursProvided ? (
              <dl className="business-hours">
                {days.map((day, i) => {
                  const h = p.hours.filter((x) => x.day_of_week === i);
                  return (
                    <div key={day}>
                      <dt>{day}</dt>
                      <dd>
                        {h.length
                          ? h
                              .map((x) =>
                                x.is_24_hours
                                  ? "Open 24 hours"
                                  : `${x.opens_at} – ${x.closes_at}`,
                              )
                              .join(" / ")
                          : "Closed"}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p>No hours provided.</p>
            )}
          </section>
        </div>
      </div>
      <Link
        className="button secondary"
        href={`/services/${encodeURIComponent(p.googlePlaceId)}`}
      >
        View Local Services listing
      </Link>
      <p className="fine-print">
        See current Google listing information and PetThread Community reviews.
      </p>
    </article>
  );
}
export function FromBusiness({ profile: p }: { profile: PublicProfile }) {
  return (
    <section className="business-panel business-teaser">
      <span className="business-source">From the business</span>
      <h2>{p.businessName}</h2>
      {p.tagline && <p>{p.tagline}</p>}
      {p.services.length > 0 && (
        <p>
          {p.services
            .slice(0, 3)
            .map((s) => s.name)
            .join(" · ")}
        </p>
      )}
      <Link className="button secondary" href={`/providers/${p.locationId}`}>
        View PetThread profile
      </Link>
      <p className="fine-print">
        Business-provided information. Separate from the Google listing.
      </p>
    </section>
  );
}
export function BusinessIndex({ items }: { items: Business[] }) {
  return (
    <>
      {items.length ? (
        items.map((b) => (
          <section className="business-panel" key={b.id}>
            <h2>{b.name}</h2>
            <p className="business-source">
              {b.status === "active"
                ? ["owner", "admin"].includes(b.role)
                  ? "Profile management"
                  : "Read-only access"
                : "Business suspended"}
            </p>
            <ul className="business-services">
              {b.locations.map((l) => (
                <li key={l.id}>
                  <span>{l.name || b.name}</span>
                  <span className="business-source">
                    {l.status === "active" ? l.profileStatus : "Suspended"}
                  </span>
                </li>
              ))}
            </ul>
            {b.status === "active" && (
              <Link
                className="button secondary"
                href={`/provider/businesses/${b.id}`}
              >
                {["owner", "admin"].includes(b.role)
                  ? "Manage profile"
                  : "View profile details"}
              </Link>
            )}
          </section>
        ))
      ) : (
        <section className="business-panel">
          <h2>Your business starts with a claim.</h2>
          <p>
            After your claim is approved, you can create a profile with
            information provided by your business.
          </p>
          <Link href="/provider/claims">View my claims</Link>
        </section>
      )}
    </>
  );
}
