export type SourceType =
  | "vet_verified"
  | "document_supported"
  | "owner_entered"
  | "care_plan"
  | "appointment"
  | "pawport_guidance";
export type PreventiveItem = {
  id: string;
  itemType: "record" | "routine" | "appointment" | "guidance";
  category: string;
  title: string;
  date: string | null;
  timeZone?: string;
  status: string;
  sourceType: SourceType;
  sourceLabel: string;
  trustLevel: "authoritative" | "supported" | "owner" | "guidance";
  actionUrl: string;
  explanation: string;
};
export type Guidance = PreventiveItem & {
  itemType: "guidance";
  sourceType: "pawport_guidance";
  trustLevel: "guidance";
  summary: string;
  discussionPrompt: string;
  ruleKey: string;
  ruleVersion: number;
  stateVersion: number | null;
  snoozedUntil: string | null;
  contentReviewedAt: string;
  source: {
    sourceKey: string;
    publisher: string;
    title: string;
    url: string;
    publicationYear: number | null;
  };
};
export type PreventiveCare = {
  pet: { id: string; name: string; species: string | null };
  needsAttention: PreventiveItem[];
  upcoming: PreventiveItem[];
  routines: PreventiveItem[];
  records: PreventiveItem[];
  guidance: Guidance[];
  savedGuidance: Guidance[];
};
export type PreventiveSummary = {
  petId: string;
  petName: string;
  attentionCount: number;
  upcomingCount: number;
  guidanceCount: number;
};
export type PreventiveProfile = {
  indoor_outdoor: string | null;
  social_exposure: string | null;
  travel_frequency: string | null;
  boarding_grooming_exposure: boolean | null;
  wildlife_exposure: boolean | null;
  owner_notes: string | null;
};
export const guidanceDisclaimer =
  "This is general preventive-care information, not a diagnosis or personalized treatment plan.";
export function itemDate(item: PreventiveItem) {
  if (!item.date) return "No next date recorded";
  const date =
    item.date.length === 10
      ? new Date(item.date + "T12:00:00Z")
      : new Date(item.date);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: item.date.length === 10 ? "UTC" : item.timeZone || "UTC",
    dateStyle: "medium",
    ...(item.date.length > 10 ? { timeStyle: "short" as const } : {}),
  }).format(date);
}
