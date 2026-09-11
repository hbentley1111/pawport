import Link from "next/link";
import { ownedPet } from "@/lib/pet-data";
import { PetNavigation } from "@/components/pet-navigation";
import { ArrowLeft, FileHeart, LockKeyhole } from "lucide-react";
import { AppFrame } from "@/components/app-frame";
import { VaccinationButton } from "@/components/forms";
import { TrustBadge } from "@/components/trust-badge";
import {
  UploadDocument,
  AttachDocument,
  RequestVerification,
  CloseVerification,
  FinishUpload,
} from "@/components/record-forms";
import type { HealthDocument, Trust } from "@/lib/records";
import { formatDate } from "@/lib/validation";
export const dynamic = "force-dynamic";
export default async function HealthRecords({
  params,
}: {
  params: Promise<{ petId: string }>;
}) {
  const { pet, db } = await ownedPet((await params).petId);
  const [v, d, t, p] = await Promise.all([
    db
      .from("vaccinations")
      .select("*")
      .eq("pet_id", pet.id)
      .order("administered_on", { ascending: false }),
    db
      .from("health_documents")
      .select("id,original_name,mime_type,byte_size,uploaded_at")
      .eq("pet_id", pet.id)
      .order("created_at", { ascending: false }),
    db.rpc("owner_vaccination_trust", { p_pet: pet.id }),
    db
      .from("veterinary_providers")
      .select("id,name")
      .eq("active", true)
      .order("name"),
  ]);
  if (v.error || d.error || t.error || p.error)
    throw new Error(
      "Unable to load health records. Confirm the verified-records migration is installed.",
    );
  const documents: HealthDocument[] = d.data || [];
  const trust: Trust[] = t.data || [];
  return (
    <AppFrame>
      <main className="setup-page records-page">
        <div className="records-container">
          <Link className="account-back" href={`/pets/${pet.id}`}>
            <ArrowLeft size={15} /> Back to overview
          </Link>
          <PetNavigation petId={pet.id} active="Health Records" />
          <div className="section-heading">
            <div>
              <p className="eyebrow">HEALTH RECORDS</p>
              <h1>{pet.name}’s health records.</h1>
              <p>
                Keep {pet.name}’s care history together, with a clear source for
                every record.
              </p>
            </div>
            <VaccinationButton petId={pet.id} />
          </div>
          <div className="trust-explainer">
            <p>
              <strong>Owner entered</strong>Added by you.
            </p>
            <p>
              <strong>Document supported</strong>A document is attached; no
              independent verification.
            </p>
            <p>
              <strong>Vet verified</strong>An authorized clinic member has
              confirmed the record.
            </p>
          </div>
          <div className="health-layout">
            <section
              aria-label="Vaccination records"
              className="health-vaccinations"
            >
              {!v.data?.length && (
                <div className="account-card empty-state">
                  <FileHeart size={30} />
                  <h2>Their story starts here.</h2>
                  <p>Add a vaccination to start building their care history.</p>
                </div>
              )}
              {v.data?.map((record) => {
                const status =
                  trust.find((s) => s.vaccination_id === record.id) || {};
                return (
                  <article
                    className="health-record account-card"
                    key={record.id}
                  >
                    <div className="section-heading">
                      <h2>{record.name}</h2>
                      <TrustBadge trust={status} />
                    </div>
                    <p className="muted">Recorded clinic: {record.clinic}</p>
                    <div className="record-dates">
                      <p>
                        Administered
                        <strong>{formatDate(record.administered_on)}</strong>
                      </p>
                      <p>
                        Next due<strong>{formatDate(record.due_on)}</strong>
                      </p>
                    </div>
                    <p className="fine-print">
                      Source:{" "}
                      {status.source === "document_supported"
                        ? "Owner entry with attached veterinary document"
                        : "Owner entry"}
                    </p>
                    {status.document_id ? (
                      <a
                        className="document-link"
                        href={`/documents/${status.document_id}`}
                      >
                        <FileHeart size={16} /> View source document (download)
                      </a>
                    ) : (
                      !status.request_id &&
                      documents.some((d) => d.uploaded_at) && (
                        <details className="record-disclosure">
                          <summary>Attach a source document</summary>
                          <AttachDocument
                            vaccinationId={record.id}
                            documents={documents}
                          />
                        </details>
                      )
                    )}
                    {status.request_status === "pending" ? (
                      <div className="record-pending">
                        <p className="muted">
                          Awaiting clinic verification. Evidence is locked while
                          the request is open.
                        </p>
                        <CloseVerification
                          requestId={status.request_id!}
                          label="Cancel verification request"
                        />
                      </div>
                    ) : (
                      status.request_status !== "verified" && (
                        <details className="record-disclosure">
                          <summary>Request clinic verification</summary>
                          <RequestVerification
                            vaccinationId={record.id}
                            providers={p.data || []}
                          />
                        </details>
                      )
                    )}
                  </article>
                );
              })}
            </section>
            <aside className="document-library account-card">
              <span className="stat-icon green">
                <LockKeyhole size={22} />
              </span>
              <h2>Your private documents</h2>
              <p className="muted">
                Keep veterinary documents close. Public passport links never
                include these files.
              </p>
              <UploadDocument petId={pet.id} />
              <div className="document-list">
                {documents.map((doc) => (
                  <div key={doc.id} className="document-item">
                    <strong>{doc.original_name}</strong>
                    <small>
                      {(doc.byte_size / 1024).toFixed(0)} KB ·{" "}
                      {doc.uploaded_at
                        ? formatDate(doc.uploaded_at)
                        : "Upload incomplete"}
                    </small>
                    {doc.uploaded_at ? (
                      <a
                        className="document-link"
                        href={`/documents/${doc.id}`}
                      >
                        View document (download)
                      </a>
                    ) : (
                      <FinishUpload documentId={doc.id} />
                    )}
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </main>
    </AppFrame>
  );
}
