"use client";
import { useActionState, useEffect, useRef, useState, useId } from "react";
import { useFormStatus } from "react-dom";
import {
  Copy,
  Check,
  X,
  Plus,
  ArrowUpRight,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import QRCode from "qrcode";
import Image from "next/image";
import Link from "next/link";
import {
  signUp,
  signIn,
  createHousehold,
  addPet,
  editPet,
  addVaccination,
  createShare,
  revokeShare,
} from "@/app/actions";
import type { ActionState, SharePass, Pet } from "@/lib/types";
import { today, formatDate } from "@/lib/validation";
export function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" disabled={pending} type="submit">
      {pending ? (
        <>
          <LoaderCircle size={16} className="spin" /> Working…
        </>
      ) : (
        children
      )}
    </button>
  );
}
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
function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}
export function AuthForm() {
  const [signup, setSignup] = useState(true);
  return (
    <>
      <div className="auth-tabs">
        <button onClick={() => setSignup(true)} aria-pressed={signup}>
          Create account
        </button>
        <button onClick={() => setSignup(false)} aria-pressed={!signup}>
          Sign in
        </button>
      </div>
      <CredentialsForm key={String(signup)} signup={signup} />
      <p className="fine-print">A little peace of mind. All in one place.</p>
    </>
  );
}
function CredentialsForm({ signup }: { signup: boolean }) {
  const [state, action] = useActionState(signup ? signUp : signIn, {});
  return (
    <form action={action} className="form-stack">
      <Field
        label="Email address"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        placeholder="you@example.com"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete={signup ? "new-password" : "current-password"}
        minLength={signup ? 12 : 1}
        maxLength={128}
        required
        placeholder={signup ? "At least 12 characters" : "Your password"}
      />
      <Feedback state={state} />
      <Submit>
        {signup ? "Create your account" : "Welcome back"}{" "}
        <ArrowUpRight size={17} />
      </Submit>
    </form>
  );
}
export function HouseholdForm() {
  const [state, action] = useActionState(createHousehold, {});
  return (
    <form action={action} className="form-stack">
      <Field
        label="Household name"
        name="name"
        placeholder="The Miller household"
        required
        maxLength={80}
      />
      <Feedback state={state} />
      <Submit>
        Create household <ArrowUpRight size={17} />
      </Submit>
    </form>
  );
}
export function PetForm({ pet }: { pet?: Pet }) {
  const [state, action] = useActionState(pet ? editPet : addPet, {});
  return (
    <form action={action} className="form-stack">
      {pet && <input type="hidden" name="pet_id" value={pet.id} />}
      <Field
        label="Pet’s name"
        name="name"
        defaultValue={pet?.name || ""}
        placeholder="e.g. Milo"
        required
        maxLength={60}
      />
      <div className="form-grid">
        <label className="field">
          <span>Species</span>
          <select name="species" defaultValue={pet?.species || "Dog"}>
            <option>Dog</option>
            <option>Cat</option>
            <option>Other</option>
          </select>
        </label>
        <label className="field">
          <span>Sex</span>
          <select name="sex" defaultValue={pet?.sex || "Unknown"}>
            <option>Unknown</option>
            <option>Female</option>
            <option>Male</option>
          </select>
        </label>
      </div>
      <Field
        label="Breed"
        name="breed"
        defaultValue={pet?.breed || ""}
        required
        maxLength={80}
        placeholder="e.g. Golden Retriever or mixed breed"
      />
      <Field
        label="Date of birth (optional)"
        type="date"
        name="birth_date"
        defaultValue={pet?.birth_date || ""}
        max={today()}
      />
      <Field
        label="Microchip number (optional, kept private)"
        name="microchip"
        defaultValue={pet?.microchip || ""}
        maxLength={30}
      />
      <Feedback state={state} />
      <Submit>
        {pet ? "Save profile" : "Create passport"} <ArrowUpRight size={17} />
      </Submit>
    </form>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <p className="eyebrow">PAWPORT · HEALTH PASSPORT</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      <p className="muted modal-description">{subtitle}</p>
      {children}
    </dialog>
  );
}
export function VaccinationButton({
  petId,
  demo = false,
}: {
  petId: string;
  demo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="button small" onClick={() => setOpen(true)}>
        <Plus size={16} /> Add vaccination
      </button>
      {open && (
        <Modal
          title="A little more peace of mind."
          subtitle="Add a vaccination from your pet’s veterinary record."
          onClose={() => setOpen(false)}
        >
          {demo ? <DemoNotice /> : <VaccinationForm petId={petId} />}
        </Modal>
      )}
    </>
  );
}
function DemoNotice() {
  return (
    <div className="demo-notice">
      <ShieldCheck size={28} />
      <h3>Make it yours.</h3>
      <p>
        This is a sample passport. Create an account to save your pet’s records
        and generate private share passes.
      </p>
      <Link href="/login" className="button">
        Create an account <ArrowUpRight size={16} />
      </Link>
    </div>
  );
}
function VaccinationForm({ petId }: { petId: string }) {
  const [state, action] = useActionState(addVaccination, {});
  return state.success ? (
    <Feedback state={state} />
  ) : (
    <form action={action} className="form-stack">
      <input type="hidden" name="pet_id" value={petId} />
      <Field
        label="Vaccination name"
        name="name"
        required
        maxLength={100}
        placeholder="e.g. Rabies"
      />
      <div className="form-grid">
        <Field
          label="Date administered"
          type="date"
          name="administered_on"
          max={today()}
          required
        />
        <Field label="Next due (optional)" type="date" name="due_on" />
      </div>
      <Field
        label="Veterinarian or clinic"
        name="clinic"
        required
        maxLength={120}
        placeholder="e.g. Oak & Willow Veterinary"
      />
      <p className="fine-print">
        Records are entered by you and are not independently verified.
      </p>
      <Feedback state={state} />
      <Submit>
        Save vaccination <Check size={16} />
      </Submit>
    </form>
  );
}
export function ShareButton({
  petId,
  demo = false,
}: {
  petId: string;
  demo?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="button" onClick={() => setOpen(true)}>
        Share passport <ArrowUpRight size={17} />
      </button>
      {open && (
        <Modal
          title="Care travels with them."
          subtitle="Give a vet, sitter, or boarding team temporary, read-only access."
          onClose={() => setOpen(false)}
        >
          {demo ? <DemoNotice /> : <ShareForm petId={petId} />}
        </Modal>
      )}
    </>
  );
}
function ShareForm({ petId }: { petId: string }) {
  const [state, action] = useActionState(createShare, {});
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    let active = true;
    if (state.url)
      QRCode.toDataURL(state.url, {
        width: 240,
        margin: 2,
        color: { dark: "#183e36", light: "#ffffff" },
      })
        .then((url) => {
          if (active) setQr(url);
        })
        .catch(() => {
          if (active) setQr("");
        });
    return () => {
      active = false;
    };
  }, [state.url]);
  return (
    <>
      <form action={action} className="form-stack">
        <input type="hidden" name="pet_id" value={petId} />
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <p>
            Includes pet details and vaccinations. Your name, email, household,
            and microchip number stay private.
          </p>
        </div>
        {!state.url && (
          <>
            <label className="field">
              <span>Access expires in</span>
              <select name="hours" defaultValue="24">
                <option value="1">1 hour</option>
                <option value="24">24 hours</option>
                <option value="168">7 days</option>
              </select>
            </label>
            <p className="fine-print">
              Anyone with the link can view the passport until it expires or you
              revoke it. They can keep a copy of what they view.
            </p>
            <Submit>
              Generate share pass <ArrowUpRight size={16} />
            </Submit>
          </>
        )}
        <Feedback state={state} />
      </form>
      {state.url && (
        <div className="share-result">
          {qr && (
            <Image
              unoptimized
              src={qr}
              width={200}
              height={200}
              alt="QR code for this temporary passport link"
            />
          )}
          <label className="field">
            <span>Private link — save it before closing</span>
            <input
              readOnly
              value={state.url}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.url!);
                setCopied(true);
                setCopyError(false);
              } catch {
                setCopyError(true);
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
            {copied ? "Copied" : "Copy link"}
          </button>
          {copyError && <p role="alert">Select and copy the link above.</p>}
          <p className="fine-print">
            Expires {new Date(state.expiresAt!).toLocaleString()}. The link is
            shown only once.
          </p>
        </div>
      )}
    </>
  );
}
export function RevokeButton({
  pass,
  petId,
}: {
  pass: SharePass;
  petId: string;
}) {
  const [state, action] = useActionState(revokeShare, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={pass.id} />
      <input type="hidden" name="pet_id" value={petId} />
      <div className="pass-row">
        <span>
          Expires {formatDate(pass.expires_at)}
          <small>
            {new Date(pass.expires_at).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: "UTC",
            })}{" "}
            UTC
          </small>
        </span>
        <Submit>Revoke</Submit>
      </div>
      <Feedback state={state} />
    </form>
  );
}
