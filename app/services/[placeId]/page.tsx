import { FromBusiness } from "@/components/business-profiles/presentation";
import type { PublicProfile } from "@/lib/business-profiles/schema";
import Link from "next/link";
import { ListingOwnership } from "@/components/provider-claiming/presentation";
import { listingClaimStatus } from "@/lib/provider-claiming/data";
import { notFound } from "next/navigation";
import { ServicesShell } from "@/components/services/shell";
import { PlaceDetails, CommunityReviews } from "@/components/services/detail";
import { ReviewForm } from "@/components/services/forms";
import {
  placeIdSchema,
  type OwnReview,
  type ReviewPage,
} from "@/lib/services/schema";
import { serviceMember } from "@/lib/services/member-data";
import { placesConfigured } from "@/lib/services/server";
export const dynamic = "force-dynamic";
export default async function ServiceDetail({
  params,
}: {
  params: Promise<{ placeId: string }>;
}) {
  const parsed = placeIdSchema.safeParse((await params).placeId);
  if (!parsed.success) notFound();
  const id = parsed.data;
  const { db, member } = await serviceMember();
  const [reviews, own, fav, owner, claimStatus, profile] = db
    ? await Promise.all([
        db.rpc("read_service_reviews", { p_place: id, p_offset: 0 }),
        member ? db.rpc("my_service_review", { p_place: id }) : null,
        member
          ? db
              .from("service_favorites")
              .select("google_place_id")
              .eq("google_place_id", id)
              .maybeSingle()
          : null,
        member ? db.from("households").select("id").maybeSingle() : null,
        listingClaimStatus(db, id),
        db.rpc("service_provider_public_profile_for_place", { p_place: id }),
      ])
    : [null, null, null, null, null, null];
  return (
    <ServicesShell>
      <PlaceDetails
        key={id}
        placeId={id}
        member={member}
        googleReady={placesConfigured()}
        saved={Boolean(fav?.data)}
      />
      {owner?.data && (
        <div className="care-service-action">
          <Link
            className="button secondary"
            href={`/appointments/new?place=${encodeURIComponent(id)}`}
          >
            Add appointment
          </Link>
          <p className="fine-print">
            Record care arranged with this business. Pawport does not make a
            booking.
          </p>
        </div>
      )}
      <ListingOwnership placeId={id} status={claimStatus} />
      {!profile?.error && profile?.data && (
        <FromBusiness profile={profile.data as PublicProfile} />
      )}
      <div className="community-layout">
        <CommunityReviews
          key={`${id}:${own?.data?.updated_at || ""}:${own?.data?.deleted_at || ""}`}
          placeId={id}
          initial={
            reviews?.error ? null : (reviews?.data as ReviewPage) || null
          }
          member={member}
        />
        {member && !own?.error && db ? (
          <ReviewForm
            key={id}
            placeId={id}
            own={(own?.data as OwnReview) || null}
          />
        ) : (
          <aside className="review-editor">
            <h2>Your experience matters.</h2>
            {member ? (
              <p>Review editing is temporarily unavailable.</p>
            ) : (
              <Link className="button" href="/login">
                Sign in to write a review
              </Link>
            )}
            <p className="fine-print">
              Your Pawport review is separate from reviews on Google Maps.
            </p>
          </aside>
        )}
      </div>
    </ServicesShell>
  );
}
