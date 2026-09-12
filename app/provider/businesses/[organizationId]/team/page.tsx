import Link from "next/link";
import { notFound } from "next/navigation";
import { ownerSession } from "@/lib/pet-data";
import { providerTeam } from "@/lib/provider-dashboard/data";
import { ServicesShell } from "@/components/services/shell";
import {
  InvitationForm,
  TeamRoster,
  PendingInvitations,
} from "@/components/provider-dashboard/forms";
import { BusinessActivity } from "@/components/provider-dashboard/presentation";
export const dynamic = "force-dynamic";
export default async function TeamPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { db } = await ownerSession();
  const { organizationId } = await params;
  const data = await providerTeam(db, organizationId);
  if (!data) notFound();
  return (
    <ServicesShell>
      <Link href="/provider/dashboard">← Business dashboard</Link>
      <header className="business-heading">
        <p className="eyebrow">TEAM</p>
        <h1>{data.team.organizationName}</h1>
        <p>Give each teammate the access they need.</p>
      </header>
      <div className="business-profile-grid">
        <TeamRoster org={organizationId} team={data.team} />
        <div>
          <section className="business-panel">
            <h2>Invite teammate</h2>
            <InvitationForm org={organizationId} team={data.team} />
          </section>
          <PendingInvitations org={organizationId} team={data.team} />
        </div>
      </div>
      <BusinessActivity events={data.audit} />
    </ServicesShell>
  );
}
