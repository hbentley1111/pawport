import Link from "next/link";
import { Brand } from "@/components/dashboard";
import { PawPrint, MapPin, Settings } from "lucide-react";
export function ServicesShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="services-page">
      <header className="services-top">
        <Brand />
        <nav aria-label="Workspace navigation">
          <Link href="/">
            <PawPrint size={16} /> Pets
          </Link>
          <Link href="/services" aria-current="page">
            <MapPin size={16} /> Services
          </Link>
          <Link href="/account">
            <Settings size={16} /> Account
          </Link>
        </nav>
      </header>
      {children}
      <footer className="services-footer">
        <PawPrint size={16} /> A little peace of mind, close to home.
        <Link href="/help">Help & privacy</Link>
      </footer>
    </main>
  );
}
