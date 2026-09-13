import Link from "next/link";
import { ownerSession } from "@/lib/pet-data";
import { businesses } from "@/lib/business-profiles/data";
import { ServicesShell } from "@/components/services/shell";
import { BusinessIndex } from "@/components/business-profiles/presentation";
export const dynamic = "force-dynamic";
export default async function Businesses() {
  const { db } = await ownerSession();
  const items = await businesses(db);
  return (
    <ServicesShell>
      <Link className="document-link" href="/provider/dashboard">
        Business dashboard
      </Link>

      <header className="business-heading">
        <p className="eyebrow">YOUR BUSINESS ON PETTHREAD</p>
        <h1>Business profiles</h1>
        <p>Help pet owners get to know your business, in your own words.</p>
        <Link href="/provider/claims">My business claims</Link>
      </header>
      {items ? (
        <BusinessIndex items={items} />
      ) : (
        <p role="status">Business profiles are temporarily unavailable.</p>
      )}
    </ServicesShell>
  );
}
