// Presentation-only compatibility for immutable legacy SQL labels and enum values.
// Never run a blanket replacement over owner/provider content or persisted data.
export function brandLabel(value: string): string {
  const labels: Record<string, string> = {
    "Confirmed through Pawport": "Confirmed through PetThread",
    "Pawport preventive-care guidance": "PetThread preventive-care guidance",
    pawport_to_partner: "PetThread to partner",
    partner_to_pawport: "Partner to PetThread",
    bidirectional: "Both directions",
  };
  return labels[value] ?? value;
}
export function preventiveExplanation(value: string): string {
  if (value.startsWith("Pawport shows this general topic for "))
    return "PetThread" + value.slice("Pawport".length);
  if (
    value ===
    "An owner-entered routine. Pawport does not medically recommend this schedule."
  )
    return "An owner-entered routine. PetThread does not medically recommend this schedule.";
  return value;
}
