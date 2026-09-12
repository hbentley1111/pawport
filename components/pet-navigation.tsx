import Link from "next/link";
export function PetNavigation({
  petId,
  active = "Overview",
}: {
  petId: string;
  active?: string;
}) {
  const base = `/pets/${petId}`;
  return (
    <nav className="pet-tabs" aria-label="Pet navigation">
      {[
        ["Overview", base],
        ["Health Records", `${base}/records`],
        ["Timeline", `${base}/timeline`],
        ["Care", `${base}/care`],
        ["Vaccinations", `${base}#vaccinations`],
        ["Share Passport", `${base}#sharing`],
        ["Edit profile", `${base}/edit`],
      ].map(([label, href]) => (
        <Link
          key={label}
          href={href}
          aria-current={active === label ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
