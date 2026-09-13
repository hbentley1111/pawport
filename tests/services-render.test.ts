import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GoogleRating,
  CommunityRatingDisplay,
  GoogleAttribution,
} from "../components/services/ratings";
import type { Place } from "../lib/services/schema";
test("Google and PetThread ratings render separately and never share a computed score", () => {
  const place = { googleRating: 4.6, googleReviewCount: 387 } as Place;
  const google = renderToStaticMarkup(createElement(GoogleRating, { place }));
  const community = renderToStaticMarkup(
    createElement(CommunityRatingDisplay, {
      rating: { average: 4.9, count: 24 },
    }),
  );
  assert.match(google, /4\.6/);
  assert.match(google, /387 Google reviews/);
  assert.doesNotMatch(google, /<strong>4\.9<|24 PetThread/);
  assert.match(community, /PetThread Community/);
  assert.match(community, /4\.9/);
  assert.match(community, /24 PetThread/);
  assert.doesNotMatch(community, /<strong>4\.6<|387 Google/);
  assert.match(
    renderToStaticMarkup(
      createElement(CommunityRatingDisplay, {
        rating: { average: null, count: 0 },
      }),
    ),
    /Be the first PetThread member/,
  );
  assert.match(
    renderToStaticMarkup(createElement(GoogleAttribution)),
    /alt="Google Maps"/,
  );
});
import { ReviewText } from "../components/services/review-text";
test("published review comments render escaped plain text, never executable HTML", () => {
  const html = renderToStaticMarkup(
    createElement(ReviewText, {
      comment: '<script>alert("x")</script><img src=x onerror=alert(1)>',
    }),
  );
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});
