import Link from "next/link";
import { OwnerAppFrame } from "@/components/owner-app-frame";
import { PawPrint } from "lucide-react";
export function ServicesShell({ children }: { children: React.ReactNode }) {
  return (
    <OwnerAppFrame>
      <main className="services-page">
        {children}
        <footer className="services-footer">
          <PawPrint size={16} /> A little peace of mind, close to home.
          <Link href="/help">Help & privacy</Link>
        </footer>
      </main>
    </OwnerAppFrame>
  );
}
