import { dollars } from "@/lib/costs/schema";
export const quoteDisclaimer =
  "This quote was entered by the business and may not include every service, tax, medication, diagnostic test or change in care. Confirm final pricing with the provider.";
export type Quote = {
  quoteId: string;
  revision: number;
  amountType: string;
  amountCents: string | null;
  minimumAmountCents: string | null;
  maximumAmountCents: string | null;
  validUntil: string | null;
  note: string | null;
  status: string;
  sourceLabel: string;
};
export function quoteAmount(q: Quote) {
  return q.amountType === "range"
    ? `${dollars(q.minimumAmountCents)} to ${dollars(q.maximumAmountCents)}`
    : q.amountType === "exact"
      ? dollars(q.amountCents)
      : "Contact for price";
}
export type QuoteRequest = {
  requestId: string;
  petId?: string;
  petName?: string;
  pet?: { name: string; species: string };
  businessName: string;
  locationId: string;
  locationName: string;
  serviceId: string;
  serviceName: string;
  status: string;
  requestedAt: string;
  ownerNote: string | null;
  currentQuote: Quote | null;
  history: Quote[];
};
export type ResponseDTO = {
  responseId: string;
  body: string;
  businessName: string;
  createdAt: string;
  updatedAt: string;
  sourceLabel: string;
};
export type Offer = {
  offerId: string;
  businessName: string;
  locationId: string | null;
  title: string;
  description: string;
  offerType: string;
  valueText: string | null;
  terms: string | null;
  startsOn: string | null;
  endsOn: string | null;
  sourceLabel: string;
};
export type Ecosystem = {
  locationId: string;
  businessName: string;
  services: { id: string; name: string; quoteRequestAvailable: boolean }[];
  offers: Offer[];
  reviews: import("@/lib/services/schema").ReviewPage;
};
export type Management = {
  role: string;
  canManage: boolean;
  locations: {
    id: string;
    name: string;
    services: { id: string; name: string; acceptsQuoteRequests: boolean }[];
    reviews: import("@/lib/services/schema").ReviewPage;
  }[];
  offers: Record<string, string | null>[];
  newQuoteRequests: number;
  sentQuotes: number;
  reviewsAwaitingResponse: number;
};
