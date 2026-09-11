import { ShieldCheck, FileCheck2, PenLine } from "lucide-react";
import { trustLabel, type Trust } from "@/lib/records";
import { formatDate } from "@/lib/validation";
export function TrustBadge({ trust }: { trust: Trust }) {
  const label = trustLabel(trust);
  const verified = label === "Vet verified";
  return (
    <div className="trust-detail">
      <span
        className={`trust-badge ${verified ? "trust-verified" : label === "Document supported" ? "trust-document" : "trust-owner"}`}
      >
        {verified ? (
          <ShieldCheck size={13} />
        ) : label === "Document supported" ? (
          <FileCheck2 size={13} />
        ) : (
          <PenLine size={13} />
        )}{" "}
        {label}
      </span>
      {verified && (
        <small>
          Verified by {trust.verified_by}
          <br />
          {formatDate(trust.verified_at || null)}
        </small>
      )}
    </div>
  );
}
