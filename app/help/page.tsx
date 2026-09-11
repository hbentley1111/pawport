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
          Your account, household, profile photos and microchip numbers are
          never included in a shared passport. Documents stay private unless you
          explicitly present an attached document to a clinic for verification.
        </p>
        <h2>What does a pass share?</h2>
        <p>
          Each pass represents exactly one pet. It shows that pet’s name,
          species, breed, sex, birth date, and vaccination records, including
          clinic names. Anyone with the URL or QR code can read these details
          until expiry or revocation. Viewers may save their own copy.
        </p>
        <h2>How do I stop sharing?</h2>
        <p>
          Open the selected pet’s Overview and revoke the pass under Active
          share passes. Passes also expire automatically after your chosen
          duration. Links are shown only when created; create a new pass if you
          lose one.
        </p>
        <h2>Are records verified?</h2>
        <p>
          Each record shows whether it is Owner entered, Document supported, or
          Vet verified by an authorized clinic. Uploading a document alone does
          not verify it. A recorded date does not certify immunity or travel
          eligibility. Ask your vet about your pet’s care schedule.
        </p>
        <h2>What’s included in this version?</h2>
        <p>
          One owner and one household with up to 20 pets, editable pet profiles,
          private photos and documents, vaccination records, clinic
          verification, and separate share passes for each pet. Open a pet’s
          passport to edit their profile. Contact the app operator for account
          deletion or record corrections.
        </p>
        <Link className="button" href="/">
          Back to overview
        </Link>
      </article>
    </main>
  );
}
