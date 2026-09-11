import Link from "next/link";
import { Brand } from "@/components/dashboard";
export default function Help() {
  return (
    <main className="setup-page">
      <Brand />
      <article className="setup-card help">
        <p className="eyebrow">HELP & PRIVACY</p>
        <h1>Their details. Your say.</h1>
        <h2>What’s private?</h2>
        <p>
          Your account, household and microchip number are never included in a
          shared passport. Your household records are accessible only to your
          signed-in account.
        </p>
        <h2>What does a pass share?</h2>
        <p>
          A pass shows your pet’s name, species, breed, sex, birth date, and
          vaccination records, including clinic names. Anyone with the URL or QR
          code can read these details until expiry or revocation. Viewers may
          save their own copy.
        </p>
        <h2>How do I stop sharing?</h2>
        <p>
          Open Overview and revoke the pass under Active share passes. Passes
          also expire automatically after your chosen duration. Links are shown
          only when created; create a new pass if you lose one.
        </p>
        <h2>Are records verified?</h2>
        <p>
          No. Vaccinations are owner-entered. A recorded date does not certify
          immunity, travel eligibility, or veterinary verification. Ask your vet
          about your pet’s care schedule.
        </p>
        <h2>What’s included in this version?</h2>
        <p>
          One owner, one household, one pet, vaccination entry, and temporary
          sharing. Contact the app operator for account deletion or record
          corrections.
        </p>
        <Link className="button" href="/">
          Back to overview
        </Link>
      </article>
    </main>
  );
}
