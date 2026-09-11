import Link from "next/link";
import { FileHeart, MapPin, Plus, UserRound, ArrowUpRight } from "lucide-react";
const actions = [
  {
    title: "Health Records",
    text: "Every pet’s care, together.",
    href: "/records",
    icon: FileHeart,
  },
  {
    title: "Local Services",
    text: "Find care close to home.",
    href: "/services",
    icon: MapPin,
  },
  {
    title: "Add Pet",
    text: "Welcome another companion.",
    href: "/pets/new",
    icon: Plus,
  },
  {
    title: "Account",
    text: "Your details and security.",
    href: "/account",
    icon: UserRound,
  },
];
export function HouseholdQuickAccess() {
  return (
    <section
      className="household-quick-access"
      aria-labelledby="quick-access-title"
    >
      <h2 id="quick-access-title">Quick access</h2>
      <div className="quick-access-grid">
        {actions.map(({ title, text, href, icon: Icon }) => (
          <Link key={href} href={href} className="quick-access-card">
            <span className="quick-access-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{text}</small>
            </span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}
