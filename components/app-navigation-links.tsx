import Link from "next/link";
import {
  House,
  PawPrint,
  FileHeart,
  MapPin,
  UserRound,
  CalendarDays,
} from "lucide-react";
const items = [
  { label: "Home", href: "/", icon: House },
  { label: "Pets", href: "/", icon: PawPrint },
  { label: "Records", href: "/records", icon: FileHeart },
  { label: "Care", href: "/appointments", icon: CalendarDays },
  { label: "Services", href: "/services", icon: MapPin },
  { label: "Account", href: "/account", icon: UserRound },
] as const;
export function activeAppSection(pathname: string) {
  if (
    pathname === "/appointments" ||
    pathname.startsWith("/appointments/") ||
    pathname === "/openings" ||
    pathname.startsWith("/openings/")
  )
    return "Care";
  if (
    pathname === "/records" ||
    /^\/pets\/[^/]+\/records(?:\/|$)/.test(pathname)
  )
    return "Records";
  if (pathname === "/services" || pathname.startsWith("/services/"))
    return "Services";
  if (
    pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/connections" ||
    pathname.startsWith("/connections/")
  )
    return "Account";
  if (pathname.startsWith("/pets/")) return "Pets";
  return pathname === "/" ? "Home" : null;
}
export function AppNavigationLinks({
  pathname,
  mobile = false,
}: {
  pathname: string;
  mobile?: boolean;
}) {
  const selected = activeAppSection(pathname);
  const active = mobile && selected === "Records" ? "Care" : selected;
  return (
    <nav
      className={mobile ? "app-mobile-nav" : "app-desktop-nav"}
      aria-label={mobile ? "Mobile Pawport navigation" : "Pawport navigation"}
    >
      {items
        .filter((item) => !mobile || item.label !== "Records")
        .map(({ label, href, icon: Icon }) => (
          <Link
            key={label}
            href={href}
            aria-current={active === label ? "page" : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
    </nav>
  );
}
