import { createClient } from "@supabase/supabase-js";
import { Brand } from "@/components/dashboard";
import { formatDate } from "@/lib/validation";
import { ShieldCheck, PawPrint } from "lucide-react";
import type { Vaccination } from "@/lib/types";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function SharedPassport({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let passport = null;
  if (/^[0-9a-f]{64}$/.test(token) && url && key) {
    const db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
    });
    const { data, error } = await db.rpc("read_share_pass", { p_token: token });
    if (error) throw new Error("Unable to load shared passport.");
    passport = data;
  }
  if (!passport)
    return (
      <main className="setup-page">
        <Brand />
        <div className="setup-card">
          <ShieldCheck size={32} />
          <h1>This pass isn’t available.</h1>
          <p className="muted">
            It may have expired, been revoked, or the link may be incorrect. Ask
            the pet’s owner for a new pass.
          </p>
        </div>
      </main>
    );
  return (
    <main className="setup-page">
      <Brand />
      <article className="shared-passport">
        <p className="eyebrow">
          <ShieldCheck size={16} /> TEMPORARY · READ-ONLY PASSPORT
        </p>
        <div className="shared-pet">
          <span className="stat-icon green">
            <PawPrint size={30} />
          </span>
          <div>
            <h1>{passport.pet.name}</h1>
            <p className="muted">
              {passport.pet.breed} · {passport.pet.species} · {passport.pet.sex}
            </p>
          </div>
        </div>
        <p>Born {formatDate(passport.pet.birth_date)}</p>
        <h2>Vaccination records</h2>
        {passport.vaccinations.length === 0 ? (
          <p className="muted">No vaccinations recorded yet.</p>
        ) : (
          passport.vaccinations.map((v: Vaccination, i: number) => (
            <div className="shared-record" key={i}>
              <h3>{v.name}</h3>
              <p>{v.clinic}</p>
              <div>
                <span>
                  Administered <strong>{formatDate(v.administered_on)}</strong>
                </span>
                <span>
                  Next due <strong>{formatDate(v.due_on)}</strong>
                </span>
              </div>
            </div>
          ))
        )}
        <p className="privacy-note">
          Owner-entered records. Not independently verified or an official
          travel certificate.
        </p>
        <p className="fine-print">
          Access expires{" "}
          {new Date(passport.expires_at).toLocaleString("en-US", {
            timeZone: "UTC",
          })}{" "}
          UTC. The owner can revoke access sooner.
        </p>
      </article>
    </main>
  );
}
