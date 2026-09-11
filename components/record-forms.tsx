"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, ShieldCheck } from "lucide-react";
import { Submit } from "@/components/forms";
import {
  attachDocument,
  requestVerification,
  verifyRecord,
  closeVerification,
  finishUpload,
} from "@/app/records/actions";
import {
  documentSchema,
  type HealthDocument,
  type Provider,
} from "@/lib/records";
import type { ActionState } from "@/lib/types";
function Feedback({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && (
        <p className="feedback error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="feedback success" role="status">
          {state.success}
        </p>
      )}
    </>
  );
}
export function UploadDocument({ petId }: { petId: string }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, setPending] = useState(false);
  const router = useRouter();
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pending) return;
        const form = e.currentTarget;
        const data = new FormData(form);
        const file = data.get("file");
        if (!(file instanceof File)) {
          setState({ error: "Choose a document." });
          return;
        }
        const valid = documentSchema.safeParse({
          name: file.name,
          type: file.type,
          size: file.size,
        });
        if (!valid.success) {
          setState({ error: valid.error.issues[0].message });
          return;
        }
        setPending(true);
        setState({});
        try {
          const response = await fetch("/documents/upload", {
            method: "POST",
            body: data,
          });
          const result = await response.json();
          setState(result);
          if (response.ok) {
            form.reset();
            router.refresh();
          }
        } catch {
          setState({
            error: "Upload interrupted. Check your connection and try again.",
          });
        } finally {
          setPending(false);
        }
      }}
    >
      <input type="hidden" name="pet_id" value={petId} />
      <label className="field">
        <span>Veterinary document</span>
        <input
          type="file"
          name="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          required
          disabled={pending}
        />
      </label>
      <p className="fine-print">
        PDF, JPG, JPEG or PNG · Up to 3 MB. Uploading supports a record; it
        never makes it vet verified.
      </p>
      <Feedback state={state} />
      <button type="submit" className="button" disabled={pending}>
        <Upload size={16} />
        {pending ? "Uploading…" : "Upload privately"}
      </button>
    </form>
  );
}
export function AttachDocument({
  vaccinationId,
  documents,
}: {
  vaccinationId: string;
  documents: HealthDocument[];
}) {
  const [state, action] = useActionState(attachDocument, {});
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="vaccination_id" value={vaccinationId} />
      <label className="field">
        <span>Support this record with a document</span>
        <select name="document_id" required defaultValue="">
          <option value="" disabled>
            Choose an uploaded document
          </option>
          {documents
            .filter((d) => d.uploaded_at)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.original_name}
              </option>
            ))}
        </select>
      </label>
      <p className="fine-print">
        Choose carefully. Attached evidence cannot be replaced in this version.
      </p>
      <Feedback state={state} />
      <Submit>Attach document</Submit>
    </form>
  );
}
export function RequestVerification({
  vaccinationId,
  providers,
}: {
  vaccinationId: string;
  providers: Provider[];
}) {
  const [state, action] = useActionState(requestVerification, {});
  if (!providers.length)
    return (
      <p className="muted">
        Provider verification will be available once a clinic has been
        onboarded.
      </p>
    );
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="vaccination_id" value={vaccinationId} />
      <label className="field">
        <span>Request verification from</span>
        <select name="provider_id" required defaultValue="">
          <option value="" disabled>
            Choose a clinic
          </option>
          {providers.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="record-consent">
        <input type="checkbox" name="consent" required />
        <span>
          I agree to share this vaccination, my pet’s name and species, and the
          entire attached document with this clinic for review. I have checked
          the document for unrelated private information.
        </span>
      </label>
      <Feedback state={state} />
      <Submit>
        Request verification <ShieldCheck size={16} />
      </Submit>
    </form>
  );
}
export function VerifyRecord({ requestId }: { requestId: string }) {
  const [state, action] = useActionState(verifyRecord, {});
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="request_id" value={requestId} />
      <label className="field">
        <span>Verification notes (optional, not shared publicly)</span>
        <textarea name="notes" maxLength={1000} rows={3} />
      </label>
      <label className="record-consent">
        <input type="checkbox" name="attest" required />
        <span>
          I have checked this vaccination against my clinic’s records or the
          supplied evidence and confirm its details on behalf of my provider
          organization.
        </span>
      </label>
      <Feedback state={state} />
      <Submit>
        Verify record <ShieldCheck size={16} />
      </Submit>
    </form>
  );
}
export function CloseVerification({
  requestId,
  label,
}: {
  requestId: string;
  label: string;
}) {
  const [state, action] = useActionState(closeVerification, {});
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="request_id" value={requestId} />
      <Feedback state={state} />
      <Submit>{label}</Submit>
    </form>
  );
}
export function FinishUpload({ documentId }: { documentId: string }) {
  const [state, action] = useActionState(finishUpload, {});
  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="document_id" value={documentId} />
      <Feedback state={state} />
      <Submit>Finish upload</Submit>
    </form>
  );
}
