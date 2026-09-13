import { brandLabel } from "@/lib/brand";
import type { Row } from "@/lib/partners/schema";
export function ConnectionStatus({ connection: c }: { connection: Row }) {
  return (
    <section className="routine-card">
      <h2>Connection operations</h2>
      <dl>
        {[
          ["Environment", c.environment],
          ["Connection status", c.status],
          ["Runtime", c.runtimeEnabled ? "Enabled" : "Disabled"],
          [
            "Credential reference",
            c.credentialReferencePresent ? "Registered" : "Not registered",
          ],
          [
            "Credential configuration",
            c.credentialConfigured ? "Present" : "Not confirmed",
          ],
          ["Health", c.health],
          ["Last validation", c.validationStatus || "Not run"],
          ["Validated at", c.lastValidatedAt || "Not run"],
          ["Validation error", c.validationError || "None recorded"],
          ["Last successful event", c.lastSuccessfulEvent || "None"],
          ["Dead letters", c.deadLetters],
          ["Unknown outcomes", c.unknownEvents],
          ["Production approval", c.productionApprovedAt || "Not approved"],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <dt>{label}</dt>
            <dd>{String(value ?? "None")}</dd>
          </div>
        ))}
      </dl>
      <p>
        Operational status is not endorsement or medical verification. A
        connection does not authorize owner data sharing.
      </p>
    </section>
  );
}
export function OperationsRows({
  rows,
  fields,
}: {
  rows: Row[];
  fields: string[];
}) {
  return (
    <div>
      {!rows.length && <p>None recorded.</p>}
      {rows.map((r, i) => (
        <article className="routine-card" key={String(r.id || i)}>
          {fields.map((k) => (
            <p key={k}>
              <strong>{k.replaceAll("_", " ")}:</strong>{" "}
              {k === "direction"
                ? brandLabel(String(r[k] ?? "Not entered"))
                : String(r[k] ?? "Not entered")}
            </p>
          ))}
        </article>
      ))}
    </div>
  );
}
