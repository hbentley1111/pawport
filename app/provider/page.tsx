import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, ArrowLeft } from "lucide-react";
import { createClient, configured } from "@/lib/supabase/server";
import { Brand } from "@/components/dashboard";
import { VerifyRecord, CloseVerification } from "@/components/record-forms";
import type { ProviderRecord } from "@/lib/records";
import { formatDate } from "@/lib/validation";
export const dynamic = "force-dynamic";
export default async function ProviderPage() {
  if (!configured()) redirect("/login");
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const { data: memberships, error: mError } = await db
    .from("provider_memberships")
    .select("provider_id")
    .eq("user_id", user.id)
    .eq("active", true);
  if (mError) throw new Error("Unable to load provider access.");
  if (!memberships?.length)
    return (
      <main className="setup-page">
        <Brand />
        <Link href="/provider/dashboard">
          Business dashboard (separate workspace)
        </Link>
        <div className="setup-card">
          <h1>Provider access required.</h1>
          <p className="muted">
            Clinic membership is granted by the PetThread administrator after
            checking your provider identity.
          </p>
          <Link className="button" href="/account">
            Your account
          </Link>
        </div>
      </main>
    );
  const { data, error: qError } = await db.rpc("provider_verification_queue");
  if (qError) throw new Error("Unable to load verification requests.");
  const records: ProviderRecord[] = data || [];
  return (
    <main className="setup-page">
      <Brand />
      <Link href="/provider/dashboard">
        Business dashboard (separate workspace)
      </Link>
      <div className="records-container">
        <Link href="/account" className="account-back">
          <ArrowLeft size={15} /> Account settings
        </Link>
        <p className="eyebrow">PROVIDER WORKSPACE</p>
        <h1>Care you can stand behind.</h1>
        <p className="muted">
          Review only the records owners have presented to your clinic. Your
          verification is attributed to your authenticated provider identity.
        </p>
        <Link className="button secondary" href="/connections">
          Scheduling connections
        </Link>
        <p className="fine-print">
          Scheduling management requires separate authorization from record
          verification.
        </p>
        <div className="provider-records">
          {!records.length && (
            <div className="account-card">
              <ShieldCheck size={30} />
              <h2>You’re all caught up.</h2>
              <p className="muted">
                No records are currently awaiting review or verified by your
                clinic.
              </p>
            </div>
          )}
          {records.map((r) => (
            <article className="account-card" key={r.id}>
              <p className="eyebrow">
                {r.provider_name} ·{" "}
                {r.status === "pending" ? "AWAITING REVIEW" : "VERIFIED"}
              </p>
              <h2>
                {r.name} · {r.pet_name}
              </h2>
              <p className="muted">
                {r.species} · Owner-recorded clinic: {r.clinic}
              </p>
              <div className="record-dates">
                <p>
                  Administered<strong>{formatDate(r.administered_on)}</strong>
                </p>
                <p>
                  Next due<strong>{formatDate(r.due_on)}</strong>
                </p>
              </div>
              {r.document_id ? (
                <a
                  className="document-link"
                  href={`/documents/${r.document_id}`}
                >
                  Review attached document: {r.document_name} (download)
                </a>
              ) : (
                r.status === "pending" && (
                  <p className="privacy-note">
                    No document attached. Verify only if you can confirm this
                    vaccination using your clinic’s own records.
                  </p>
                )
              )}
              {r.status === "pending" ? (
                <VerifyRecord requestId={r.id} />
              ) : (
                <>
                  <p className="muted">
                    Verified {formatDate(r.verified_at)}. Revoking removes the
                    verified badge from the owner’s passport and existing share
                    links.
                  </p>
                  <CloseVerification
                    requestId={r.id}
                    label="Revoke verification"
                  />
                </>
              )}
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
