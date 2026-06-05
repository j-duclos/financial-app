import { describe, expect, it } from "vitest";
import type { SubscriptionIntelligenceItem } from "@budget-app/shared";
import { sortSubscriptionItems, subscriptionConfidenceLabel } from "./subscriptionIntelligence";

function item(
  overrides: Partial<SubscriptionIntelligenceItem> & Pick<SubscriptionIntelligenceItem, "id" | "name">
): SubscriptionIntelligenceItem {
  return {
    source: "recurring_rule",
    rule_id: 1,
    monthly_amount: "10.00",
    category: null,
    account_name: null,
    active: true,
    charge_count: null,
    last_charge_date: null,
    confidence: "high",
    ...overrides,
  };
}

describe("subscriptionIntelligence", () => {
  it("sorts by monthly amount descending", () => {
    const sorted = sortSubscriptionItems([
      item({ id: "a", name: "Spotify", monthly_amount: "10.99" }),
      item({ id: "b", name: "Netflix", monthly_amount: "15.99" }),
    ]);
    expect(sorted.map((s) => s.name)).toEqual(["Netflix", "Spotify"]);
  });

  it("labels detected items", () => {
    expect(
      subscriptionConfidenceLabel(
        item({ id: "d", name: "Adobe", source: "detected", confidence: "high", rule_id: null })
      )
    ).toBe("Detected from bank history");
  });
});
