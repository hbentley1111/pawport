"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Bookmark, Star, Flag } from "lucide-react";
import {
  saveReview,
  withdrawReview,
  setFavorite,
  reportReview,
  savePreference,
  type ServiceActionState,
} from "@/app/services/actions";
import type { OwnReview } from "@/lib/services/schema";
function Submit({
  children,
  className = "button small",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
export function ServiceFeedback({ state }: { state: ServiceActionState }) {
  return (
    <>
      {state.error && (
        <p className="feedback error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="feedback success" role="status">
          {state.success}
        </p>
      )}
    </>
  );
}
export function FavoriteButton({
  placeId,
  saved = false,
}: {
  placeId: string;
  saved?: boolean;
}) {
  const [state, action] = useActionState(setFavorite, {});
  const current = state.saved ?? saved;
  return (
    <form action={action} className="favorite-form">
      <input type="hidden" name="placeId" value={placeId} />
      <input type="hidden" name="saved" value={String(!current)} />
      <Submit className="service-save">
        <Bookmark size={17} fill={current ? "currentColor" : "none"} />
        {current ? "Saved · Remove" : "Save place"}
      </Submit>
      {state.error && (
        <p role="alert" className="feedback error">
          {state.error}
        </p>
      )}
      <span className="sr-only" role="status">
        {state.success}
      </span>
    </form>
  );
}
export function ReviewForm({
  placeId,
  own,
}: {
  placeId: string;
  own: OwnReview;
}) {
  const [state, action] = useActionState(saveReview, {});
  return (
    <section className="review-editor">
      <h2>
        {own && !own.deleted_at
          ? "Your PetThread review"
          : "Share your experience"}
      </h2>
      <p className="muted">
        Your PetThread review is separate from reviews on Google Maps.
      </p>
      {own?.hidden ? (
        <p className="feedback">
          This review is under moderation and cannot be edited.
        </p>
      ) : (
        <form action={action} className="form-stack">
          <input type="hidden" name="placeId" value={placeId} />
          <fieldset className="star-picker">
            <legend>Your rating</legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n}>
                <input
                  type="radio"
                  name="rating"
                  value={n}
                  defaultChecked={own?.rating === n}
                  required
                />
                <span>
                  <Star size={22} />
                  {n}
                  <span className="sr-only"> star{n === 1 ? "" : "s"}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Your experience (optional)</span>
            <textarea
              name="comment"
              maxLength={1500}
              rows={4}
              defaultValue={own?.comment || ""}
              placeholder="What would you tell another pet parent?"
            />
          </label>
          <p className="fine-print">
            Up to 1,500 characters. Published as PetThread Member. Please leave
            out personal contact details and private pet health information.
          </p>
          <ServiceFeedback state={state} />
          <Submit>{own ? "Save my review" : "Publish PetThread review"}</Submit>
        </form>
      )}
      {own && !own.deleted_at && <WithdrawForm placeId={placeId} id={own.id} />}
      {own?.deleted_at && (
        <p className="fine-print">
          Your previous review is withdrawn. Saving publishes it again, unless
          it is under moderation.
        </p>
      )}
    </section>
  );
}
function WithdrawForm({ placeId, id }: { placeId: string; id: string }) {
  const [state, action] = useActionState(withdrawReview, {});
  return (
    <form action={action} className="withdraw-review">
      <input type="hidden" name="placeId" value={placeId} />
      <input type="hidden" name="id" value={id} />
      <Submit className="text-button">Withdraw my review</Submit>
      <ServiceFeedback state={state} />
    </form>
  );
}
export function ReportReview({ reviewId }: { reviewId: string }) {
  const [state, action] = useActionState(reportReview, {});
  return (
    <details className="review-report">
      <summary>
        <Flag size={12} /> Report review
      </summary>
      {state.success ? (
        <ServiceFeedback state={state} />
      ) : (
        <form action={action} className="form-stack">
          <input type="hidden" name="reviewId" value={reviewId} />
          <label className="field">
            <span>Reason</span>
            <select name="reason" required defaultValue="">
              <option value="" disabled>
                Choose a reason
              </option>
              <option value="spam">Spam</option>
              <option value="harassment">Harassment</option>
              <option value="privacy">Private information</option>
              <option value="misleading">Misleading content</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="field">
            <span>Details (optional)</span>
            <textarea name="details" maxLength={500} rows={2} />
          </label>
          <ServiceFeedback state={state} />
          <Submit>Send report</Submit>
        </form>
      )}
    </details>
  );
}
export function AreaPreference({
  zip,
  radius,
  hasPreference,
}: {
  zip: string;
  radius: number;
  hasPreference: boolean;
}) {
  const [state, action] = useActionState(savePreference, {});
  return (
    <form action={action} className="area-preference">
      <input type="hidden" name="postal_code" value={zip} />
      <input type="hidden" name="radius_miles" value={radius} />
      <Submit className="text-button">Remember this ZIP & radius</Submit>
      {hasPreference && (
        <button
          className="text-button"
          name="forget"
          value="true"
          type="submit"
        >
          Forget saved area
        </button>
      )}
      <ServiceFeedback state={state} />
    </form>
  );
}
