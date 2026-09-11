export function ReviewText({ comment }: { comment: string }) {
  // Treat first-party reviews as plain text; never interpret stored HTML.
  return <p className="review-comment">{comment}</p>;
}
