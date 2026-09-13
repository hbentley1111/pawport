import { brandLabel } from "@/lib/brand";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ownerSession } from "@/lib/pet-data";
import { AppFrame } from "@/components/app-frame";
import { OperatorForm } from "@/components/partners/forms";
import type { Consent } from "@/lib/partners/schema";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Connection sharing | PetThread",
  robots: { index: false, follow: false },
};
export default async function ConnectionConsent({
  params,
}: {
  params: Promise<{ connectionId: string }>;
}) {
  const { connectionId } = await params;
  if (!z.uuid().safeParse(connectionId).success) notFound();
  const { db } = await ownerSession();
  const { data, error } = await db.rpc("my_partner_connection_consent", {
    p_connection: connectionId,
  });
  if (error || !data) notFound();
  const c = data as Consent;
  return (
    <AppFrame>
      <main className="care-page">
        <Link href="/account">Account</Link>
        <h1>{c.partnerName}: connection sharing</h1>
        <p>
          Choose what PetThread may share with this existing connection.
          Granting permission does not enable an integration.
        </p>
        <p>
          Environment: {c.environment} · Status: {c.status}
        </p>
        <p>
          No health records, vaccinations, insurance, financial records or
          preventive profiles are shared by these controls.
        </p>
        <h2>Current authorizations</h2>
        {c.grants.length ? (
          c.grants.map((g, i) => (
            <p key={i}>
              {g.category} · {g.purpose} · {brandLabel(g.direction)} ·{" "}
              {g.expiresAt || "Until revoked"}
            </p>
          ))
        ) : (
          <p>No data sharing authorized.</p>
        )}
        <OperatorForm
          action="grant"
          hidden={{ connection: connectionId }}
          label="Save my sharing choice"
          fields={[
            {
              name: "category",
              label: "Data category",
              options: ["pet_identity", "owner_contact", "appointment_data"],
            },
            {
              name: "purpose",
              label: "Purpose",
              options: ["scheduling", "integration_setup"],
            },
            {
              name: "direction",
              label: "Direction",
              options: [
                "pawport_to_partner",
                "partner_to_pawport",
                "bidirectional",
              ],
            },
            {
              name: "expires",
              label: "Optional expiration (UTC)",
              type: "datetime-local",
            },
            {
              name: "enabled",
              label:
                "I authorize this category. Leave unchecked to revoke this category, purpose and direction.",
              type: "checkbox",
            },
          ]}
        />
      </main>
    </AppFrame>
  );
}
