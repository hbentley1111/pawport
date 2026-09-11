import { ServicesShell } from "@/components/services/shell";
import { ServicesSearch } from "@/components/services/search";
import { serviceMember } from "@/lib/services/member-data";
import { placesConfigured } from "@/lib/services/server";
export const dynamic = "force-dynamic";
export default async function Services() {
  const { db, member } = await serviceMember();
  const [prefs, favs] =
    member && db
      ? await Promise.all([
          db
            .from("user_service_preferences")
            .select("postal_code,radius_miles")
            .maybeSingle(),
          db
            .from("service_favorites")
            .select("google_place_id")
            .order("created_at", { ascending: false }),
        ])
      : [null, null];
  return (
    <ServicesShell>
      <ServicesSearch
        member={member}
        googleReady={placesConfigured()}
        preference={prefs?.data || null}
        savedIds={(favs?.data || []).map((f) => f.google_place_id)}
        communityReady={!member || !(prefs?.error || favs?.error)}
      />
    </ServicesShell>
  );
}
