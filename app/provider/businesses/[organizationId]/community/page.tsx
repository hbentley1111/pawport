import Link from "next/link";
import { ownerSession } from "@/lib/pet-data";
import { ServicesShell } from "@/components/services/shell";
import { ecosystemRpc } from "@/lib/ecosystem/data";
import type { Management } from "@/lib/ecosystem/schema";
import { EcosystemForm } from "@/components/ecosystem/forms";
export const dynamic = "force-dynamic";
export default async function Community({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId: org } = await params,
    { db } = await ownerSession();
  const m = await ecosystemRpc<Management>(db, "my_business_ecosystem", {
    p_org: org,
  });
  const offerFields = (o: Record<string, string | null> = {}) => [
    {
      name: "title",
      label: "Offer title",
      required: true,
      max: 120,
      value: o.title,
    },
    {
      name: "description",
      label: "Description",
      required: true,
      type: "textarea",
      max: 1000,
      value: o.description,
    },
    {
      name: "offer_type",
      label: "Offer type",
      options: [
        "promotion",
        "new_client",
        "service_package",
        "informational",
      ].map((id) => ({ id, name: id.replaceAll("_", " ") })),
      value: o.offer_type,
    },
    {
      name: "value_text",
      label: "Value text (not calculated)",
      max: 100,
      value: o.value_text,
    },
    {
      name: "terms",
      label: "Terms",
      type: "textarea",
      max: 1500,
      value: o.terms,
    },
    { name: "starts_on", label: "Starts on", type: "date", value: o.starts_on },
    { name: "ends_on", label: "Ends on", type: "date", value: o.ends_on },
    {
      name: "status",
      label: "Publication status",
      options: ["draft", "published", "paused", "expired", "archived"].map(
        (id) => ({ id, name: id }),
      ),
      value: o.status || "draft",
    },
  ];
  return (
    <ServicesShell>
      <main className="care-page">
        <h1>Business quotes, offers &amp; reviews</h1>
        <Link href="/provider/dashboard">Business dashboard</Link>
        <Link href={`/provider/businesses/${org}/quotes`}>
          Quote requests: {m.newQuoteRequests} new · {m.sentQuotes} sent
        </Link>
        <p>{m.reviewsAwaitingResponse} reviews awaiting response</p>
        {!m.canManage && (
          <p>
            Read-only. Owners and admins manage quotes, offers and review
            responses.
          </p>
        )}
        <h2>Quote settings</h2>
        {m.locations.map((l) => (
          <section className="routine-summary" key={l.id}>
            <h3>{l.name}</h3>
            {l.services.map((s) =>
              m.canManage ? (
                <EcosystemForm
                  key={s.id}
                  action="setting"
                  hidden={{ org, location: l.id, service: s.id }}
                  label={`Save ${s.name} setting`}
                  fields={[
                    {
                      name: "enabled",
                      label: `Accept quote requests: ${s.name}`,
                      type: "checkbox",
                      value: s.acceptsQuoteRequests ? "on" : "",
                    },
                  ]}
                />
              ) : (
                <p key={s.id}>
                  {s.name} · Quote requests{" "}
                  {s.acceptsQuoteRequests ? "enabled" : "disabled"}
                </p>
              ),
            )}
            <h3>PetThread community reviews</h3>
            {l.reviews.reviews.map((r) => (
              <article className="routine-card" key={r.id}>
                <h4>PetThread Member · {r.rating} stars</h4>
                <p>{r.comment}</p>
                {m.canManage ? (
                  <EcosystemForm
                    action="response"
                    hidden={{ org, location: l.id, review: r.id }}
                    label="Save business response"
                    warning="Do not include customer names, contact information, medical details or other private information."
                    fields={[
                      {
                        name: "body",
                        label: "Response from claimed business",
                        type: "textarea",
                        required: true,
                        max: 1500,
                        value: r.response?.body,
                      },
                      {
                        name: "status",
                        label: "Response status",
                        options: ["published", "withdrawn"].map((id) => ({
                          id,
                          name: id,
                        })),
                      },
                    ]}
                  />
                ) : (
                  r.response && <p>{r.response.body}</p>
                )}
              </article>
            ))}
          </section>
        ))}
        <h2>Business offers</h2>
        {m.canManage && (
          <details>
            <summary>Create offer</summary>
            <EcosystemForm
              action="offer"
              hidden={{ org }}
              label="Save offer"
              warning="An offer does not change search rank or recommend medical care."
              fields={[
                {
                  name: "location",
                  label: "Location",
                  options: [
                    { id: "", name: "All organization locations" },
                    ...m.locations.map((l) => ({ id: l.id, name: l.name })),
                  ],
                },
                ...offerFields(),
              ]}
            />
          </details>
        )}
        {m.offers.map((o) => (
          <article className="routine-card" key={o.id}>
            <h3>{o.title}</h3>
            <p>{o.status}</p>
            {m.canManage ? (
              <details>
                <summary>Edit / publish / pause / archive</summary>
                <EcosystemForm
                  action="offer"
                  hidden={{
                    org,
                    offer: String(o.id),
                    location: o.location_id || "",
                  }}
                  label="Save offer"
                  fields={offerFields(o)}
                />
              </details>
            ) : (
              <p>{o.description}</p>
            )}
          </article>
        ))}
      </main>
    </ServicesShell>
  );
}
