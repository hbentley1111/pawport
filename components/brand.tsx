import Link from "next/link";
import { PawPrint } from "lucide-react";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Pawport home">
      <span className="brand-icon">
        <PawPrint size={23} fill="currentColor" aria-hidden="true" />
      </span>
      pawport<span className="brand-dot">®</span>
    </Link>
  );
}
