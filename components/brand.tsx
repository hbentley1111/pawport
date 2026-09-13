import Link from "next/link";
import { PawPrint } from "lucide-react";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="PetThread home">
      <span className="brand-icon">
        <PawPrint size={23} fill="currentColor" aria-hidden="true" />
      </span>
      PetThread<span className="brand-dot">®</span>
    </Link>
  );
}
