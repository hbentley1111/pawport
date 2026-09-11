import { createClient, configured } from "@/lib/supabase/server";
import { AppFrame } from "./app-frame";
import { Brand } from "./brand";
// Shared account/services pages may also be visited by providers or signed-out users.
// Only a server-verified household owner receives owner navigation. No routing changes.
export async function OwnerAppFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  if (configured()) {
    const db = await createClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (user) {
      const { data: household, error } = await db
        .from("households")
        .select("id")
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!error && household) return <AppFrame>{children}</AppFrame>;
    }
  }
  return (
    <>
      <header className="guest-workspace-brand">
        <Brand />
      </header>
      {children}
    </>
  );
}
