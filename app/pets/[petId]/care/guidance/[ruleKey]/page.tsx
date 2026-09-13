import { preventiveExplanation } from "@/lib/brand";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ownedPet } from "@/lib/pet-data";
import { AppFrame } from "@/components/app-frame";
import { GuidanceActions } from "@/components/preventive-care/client";
import { SourceBadge } from "@/components/preventive-care/presentation";
import {
  guidanceDisclaimer,
  type Guidance,
} from "@/lib/preventive-care/schema";
export const dynamic = "force-dynamic";
export default async function GuidancePage({
  params,
}: {
  params: Promise<{ petId: string; ruleKey: string }>;
}) {
  const { petId, ruleKey } = await params;
  if (!/^[a-z0-9_]{1,100}$/.test(ruleKey)) notFound();
  const { pet, db } = await ownedPet(petId);
  const [{ data, error }, next] = await Promise.all([
    db.rpc("preventive_guidance_detail", {
      p_pet: pet.id,
      p_rule_key: ruleKey,
    }),
    db
      .from("appointments")
      .select("id,title,starts_at")
      .eq("pet_id", pet.id)
      .in("status", ["scheduled", "confirmed"])
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(1),
  ]);
  if (error || !data) notFound();
  const g = data as Guidance;
  return (
    <AppFrame>
      <main className="care-page">
        <Link href={`/pets/${pet.id}/care`}>Back to {pet.name}’s care</Link>
        <SourceBadge item={g} />
        <h1>{g.title}</h1>
        <p>{guidanceDisclaimer}</p>
        <section className="routine-card">
          <h2>General information</h2>
          <p>{g.summary}</p>
          <h2>Why am I seeing this?</h2>
          <p>{preventiveExplanation(g.explanation)}</p>
          <h2>Things to ask your veterinarian</h2>
          <p>{g.discussionPrompt}</p>
          <p>
            Your veterinarian can recommend what’s appropriate for {pet.name}.
          </p>
          <h2>Source</h2>
          <p>
            {g.source.publisher} · {g.source.title} ({g.source.publicationYear})
          </p>
          <a
            className="document-link"
            href={g.source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the source
          </a>
          <p>
            Content reviewed: {g.contentReviewedAt.slice(0, 10)} · Version{" "}
            {g.ruleVersion}
          </p>
          <p className="fine-print">
            Source attribution does not imply publisher endorsement or
            veterinary verification of this topic.
          </p>
          <p>
            Your preference:{" "}
            {g.status === "discussed"
              ? "Marked discussed by you — not medical verification"
              : g.status === "not_relevant"
                ? "Not relevant"
                : g.status === "snoozed"
                  ? `Hidden until ${g.snoozedUntil}`
                  : "Active discussion topic"}
          </p>
          {g.stateVersion && g.stateVersion !== g.ruleVersion && (
            <p>
              The content has a newer version. Your saved preference remains in
              place.
            </p>
          )}
        </section>
        <GuidanceActions petId={pet.id} guidance={g} />
        <div className="care-page-links">
          <Link href="/care/plans/new">Create a care plan</Link>
          {next.data?.[0] && (
            <Link href={`/appointments/${next.data[0].id}`}>
              Ask at next appointment: {next.data[0].title}
            </Link>
          )}
        </div>
        <p className="fine-print">
          Nothing is sent to the provider. Creating a care plan is a separate
          action; you choose its schedule.
        </p>
      </main>
    </AppFrame>
  );
}
