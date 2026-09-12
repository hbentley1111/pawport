import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { DashboardOrganization, Team, BusinessAudit } from "./schema";
import { z } from "zod";
type DB = Awaited<ReturnType<typeof createClient>>;
export async function providerDashboard(db: DB) {
  const r = await db.rpc("my_service_provider_dashboard");
  if (r.error) return null;
  const organizations = r.data as DashboardOrganization[];
  if (process.env.NODE_ENV === "production")
    for (const o of organizations)
      for (const l of o.locations)
        if (l.scheduling.system === "mock")
          l.scheduling.availabilitySupported = false;
  return organizations;
}
export async function providerTeam(db: DB, organization: string) {
  if (!z.uuid().safeParse(organization).success) return null;
  const [team, audit] = await Promise.all([
    db.rpc("service_provider_team", { p_organization: organization }),
    db.rpc("service_provider_audit_history", { p_organization: organization }),
  ]);
  if (team.error || audit.error) return null;
  return { team: team.data as Team, audit: audit.data as BusinessAudit[] };
}
