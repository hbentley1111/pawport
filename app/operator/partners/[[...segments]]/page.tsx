import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ServicesShell } from "@/components/services/shell";
import { operatorData } from "@/lib/partners/data";
import {
  partnerCapabilities,
  partnerTypes,
  type Row,
} from "@/lib/partners/schema";
import {
  OperatorForm,
  ValidateConnection,
  type Field,
} from "@/components/partners/forms";
import {
  ConnectionStatus,
  OperationsRows,
} from "@/components/partners/presentation";
const grantFields: Field[] = [
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
    options: ["pawport_to_partner", "partner_to_pawport", "bidirectional"],
  },
  {
    name: "expires",
    label: "Optional expiration (UTC)",
    type: "datetime-local",
  },
  {
    name: "enabled",
    label: "Explicitly authorize this category (uncheck to revoke)",
    type: "checkbox",
  },
];

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Partner operations | Pawport",
  robots: { index: false, follow: false },
};
export default async function Partners({
  params,
}: {
  params: Promise<{ segments?: string[] }>;
}) {
  const { segments: s = [] } = await params;
  if (
    ![0, 1, 3].includes(s.length) ||
    (s[0] && !z.uuid().safeParse(s[0]).success) ||
    (s.length === 3 &&
      (s[1] !== "connections" || !z.uuid().safeParse(s[2]).success))
  )
    notFound();
  const d = await operatorData(s[0] || null, s[2] || null),
    p = d.partners.find((v) => v.id === s[0]),
    c = d.connections.find((v) => v.id === s[2]),
    admin = d.role === "admin";
  if (s[0] && !p) notFound();
  const base = "/operator/partners/" + s[0];
  const partnerFields = (p: Row = {}): Field[] =>
    [
      "partner_key",
      "display_name",
      "partner_type",
      "legal_name",
      "external_reference",
      "contract_status",
      "contract_effective_on",
      "contract_expires_on",
      "technical_owner_name",
      "technical_owner_email",
      "support_email",
      "security_contact_email",
      "privacy_contact_email",
      "notes",
    ].map((k) => ({
      name: k,
      label: k.replaceAll("_", " "),
      value: String(p[k] || ""),
      options:
        k === "partner_type"
          ? partnerTypes
          : k === "contract_status"
            ? [
                "none",
                "evaluation",
                "negotiating",
                "executed",
                "suspended",
                "terminated",
              ]
            : undefined,
      type: k.endsWith("_on")
        ? "date"
        : k.endsWith("_email")
          ? "email"
          : k === "notes"
            ? "textarea"
            : undefined,
      required: ["partner_key", "display_name"].includes(k),
    }));
  const pilotFields = (v: Row = {}): Field[] =>
    [
      "connection_id",
      "organization_id",
      "location_id",
      "external_site_reference",
      "status",
      "consent_received_at",
      "pilot_started_at",
      "pilot_ends_at",
      "completed_at",
      "notes",
    ].map((k) => ({
      name: k,
      label: k.replaceAll("_", " ") + (k.endsWith("_at") ? " (UTC)" : ""),
      value:
        k.endsWith("_at") && v[k]
          ? new Date(String(v[k])).toISOString().slice(0, 16)
          : String(v[k] || ""),
      type: k.endsWith("_at")
        ? "datetime-local"
        : k === "notes"
          ? "textarea"
          : undefined,
      options:
        k === "status"
          ? [
              "candidate",
              "contacted",
              "consented",
              "credentials_pending",
              "ready",
              "active",
              "completed",
              "withdrawn",
              "failed",
            ]
          : undefined,
    }));
  return (
    <ServicesShell>
      <main className="care-page">
        <Link href="/operator/partners">Partner operations</Link>
        <h1>
          {p ? String(p.display_name) : "Partner activation & operations"}
        </h1>
        <p>
          Internal operational records. No public endorsement or owner data
          access is implied.
        </p>
        <p>
          Sandbox runtime switch: {d.runtime.sandboxEnabled ? "On" : "Off"} ·
          Production runtime switch:{" "}
          {d.runtime.productionEnabled ? "On" : "Off"}
        </p>
        {!p ? (
          <>
            <p>No active partners or connections are seeded.</p>
            {d.partners.map((v) => (
              <article className="routine-card" key={String(v.id)}>
                <Link href={"/operator/partners/" + v.id}>
                  {String(v.display_name)}
                </Link>
                <p>
                  Contract: {String(v.contract_status)} · Relationship:{" "}
                  {String(v.status)}
                </p>
              </article>
            ))}
            {admin && (
              <details>
                <summary>Register candidate partner</summary>
                <OperatorForm
                  action="registry"
                  label="Register candidate"
                  fields={partnerFields()}
                />
              </details>
            )}
          </>
        ) : c ? (
          <>
            <Link href={base}>Partner overview</Link>
            <ConnectionStatus connection={c} />
            <ValidateConnection connectionId={String(c.id)} />
            {admin && (
              <details>
                <summary>Register credential reference</summary>
                <p>
                  Enter only an opaque PARTNER_ reference. Never paste a secret.
                  Registering clears validation and disables runtime.
                </p>
                <OperatorForm
                  action="credential"
                  hidden={{ connection: String(c.id) }}
                  fields={[
                    {
                      name: "reference",
                      label: "Credential reference",
                      required: true,
                      max: 108,
                    },
                  ]}
                  label="Register reference"
                />
              </details>
            )}
            <h2>Activation controls</h2>
            <p>
              Technical approval and runtime enablement are separate. Production
              remains blocked by the deployment controls and missing registered
              adapters.
            </p>
            <OperatorForm
              action="activation"
              hidden={{ connection: String(c.id) }}
              fields={[
                {
                  name: "operation",
                  label: "Action",
                  options: admin
                    ? [
                        "request_production",
                        "approve_production",
                        "enable",
                        "pause",
                        "disable",
                        "revoke",
                      ]
                    : ["request_production", "pause", "disable", "revoke"],
                },
                {
                  name: "reason",
                  label: "Operational reason (no secrets or owner information)",
                  max: 500,
                },
              ]}
              label="Apply connection action"
            />
            <h2>Explicit data grants</h2>
            <OperationsRows
              rows={d.grants}
              fields={[
                "dataCategory",
                "purpose",
                "direction",
                "status",
                "expiresAt",
              ]}
            />
            {admin && c.scope === "business" && (
              <OperatorForm
                action="grant"
                hidden={{ connection: String(c.id) }}
                label="Save business-scope authorization"
                fields={grantFields}
              />
            )}
            <h2>Capabilities</h2>
            <OperationsRows
              rows={d.capabilities.filter(
                (v) => v.environment === c.environment,
              )}
              fields={["capability_key", "environment", "status", "expires_at"]}
            />
            {admin && c.scope === "business" && (
              <details>
                <summary>Link existing ezyVet scheduling connection</summary>
                <OperatorForm
                  action="bridge"
                  hidden={{ connection: String(c.id) }}
                  label="Link matching scheduling connection"
                  fields={[
                    {
                      name: "provider",
                      label: "Existing provider connection ID",
                      required: true,
                    },
                  ]}
                />
              </details>
            )}
            <h2>Recent integration events</h2>
            <OperationsRows
              rows={d.events}
              fields={[
                "event_type",
                "direction",
                "status",
                "attempt_count",
                "http_status",
                "error_code",
                "created_at",
              ]}
            />
            <h2>Activation history</h2>
            <OperationsRows
              rows={d.activation}
              fields={["event_type", "reason", "created_at"]}
            />
          </>
        ) : (
          <>
            <p>
              Contract: {String(p.contract_status)} · Relationship:{" "}
              {String(p.status)}
            </p>
            {admin && (
              <details>
                <summary>Contract and contact metadata</summary>
                <OperatorForm
                  action="registry"
                  hidden={{ partner: String(p.id) }}
                  fields={partnerFields(p)}
                  label="Save contract metadata"
                />
              </details>
            )}
            <OperatorForm
              action="partner_status"
              hidden={{ partner: String(p.id) }}
              label="Set relationship status"
              fields={[
                {
                  name: "status",
                  label: "Operational relationship status",
                  options: admin
                    ? ["candidate", "sandbox", "active", "paused", "terminated"]
                    : ["paused", "terminated"],
                  value: String(p.status),
                },
              ]}
            />
            <h2>Connections</h2>
            {d.connections.map((v) => (
              <p key={String(v.id)}>
                <Link href={`${base}/connections/${v.id}`}>
                  {String(v.environment)} · {String(v.scope)} ·{" "}
                  {v.runtimeEnabled ? "Enabled" : "Disabled"}
                </Link>
              </p>
            ))}
            {admin && (
              <details>
                <summary>Create disabled connection</summary>
                <OperatorForm
                  action="connection"
                  hidden={{ partner: String(p.id) }}
                  label="Create connection (runtime disabled)"
                  fields={[
                    {
                      name: "environment",
                      label: "Stored environment",
                      options: ["sandbox", "production"],
                    },
                    {
                      name: "organization",
                      label: "Organization ID (business scope)",
                    },
                    {
                      name: "location",
                      label: "Location ID (optional business scope)",
                    },
                    {
                      name: "household",
                      label:
                        "Household ID (owner scope; choose one scope only)",
                    },
                  ]}
                />
              </details>
            )}
            <h2>Typed capabilities</h2>
            <OperationsRows
              rows={d.capabilities}
              fields={["capability_key", "environment", "status", "expires_at"]}
            />
            {admin && (
              <OperatorForm
                action="capability"
                hidden={{ partner: String(p.id) }}
                label="Set capability approval"
                fields={[
                  {
                    name: "capability",
                    label: "Capability",
                    options: [...partnerCapabilities],
                  },
                  {
                    name: "environment",
                    label: "Approval environment",
                    options: ["sandbox", "production"],
                  },
                  {
                    name: "status",
                    label: "Status",
                    options: ["requested", "approved", "paused", "revoked"],
                  },
                  {
                    name: "expires",
                    label: "Approval expires (UTC)",
                    type: "datetime-local",
                  },
                ]}
              />
            )}
            <h2>Pilot sites</h2>
            <p>
              Planning target: five consenting sites; six-week pilot. This is a
              target, not a claim that a pilot is running.
            </p>
            <p>
              {Object.entries(d.pilotCounts)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ") || "No pilot sites recorded."}
            </p>
            <details>
              <summary>Add candidate pilot site</summary>
              <p>
                Business/site references only. No credentials or patient
                information.
              </p>
              <OperatorForm
                action="pilot"
                hidden={{ partner: String(p.id) }}
                label="Save pilot site"
                fields={pilotFields()}
              />
            </details>
            {d.pilots.map((v) => (
              <details key={String(v.id)}>
                <summary>
                  {String(v.external_site_reference || "Pilot site")} ·{" "}
                  {String(v.status)}
                </summary>
                <OperatorForm
                  action="pilot"
                  hidden={{ partner: String(p.id), pilot: String(v.id) }}
                  label="Update pilot record"
                  fields={pilotFields(v)}
                />
              </details>
            ))}
            <h2>Operator audit</h2>
            <OperationsRows
              rows={d.audit}
              fields={["event_type", "created_at"]}
            />
            <h2>ezyVet readiness</h2>
            <p>
              Existing scheduling sandbox stack remains separate. Booking and
              documented cancellation foundations exist; connected rescheduling
              is unsupported. No commercial certification, pilot or production
              enablement is claimed.
            </p>
          </>
        )}
      </main>
    </ServicesShell>
  );
}
