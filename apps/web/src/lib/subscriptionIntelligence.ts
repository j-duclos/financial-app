import type { SubscriptionIntelligenceItem } from "@budget-app/shared";

/** Sort subscriptions by monthly cost descending, then name. */
export function sortSubscriptionItems(
  items: SubscriptionIntelligenceItem[]
): SubscriptionIntelligenceItem[] {
  return [...items].sort((a, b) => {
    const diff = parseFloat(b.monthly_amount) - parseFloat(a.monthly_amount);
    if (Math.abs(diff) > 0.0001) return diff;
    return a.name.localeCompare(b.name);
  });
}

export function subscriptionConfidenceLabel(
  item: SubscriptionIntelligenceItem
): string | null {
  if (item.source !== "detected") return null;
  if (item.confidence === "high") return "Detected from bank history";
  if (item.confidence === "medium") return "Likely subscription";
  return "Possible subscription";
}
