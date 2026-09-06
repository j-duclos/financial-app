import { describe, expect, it } from "vitest";
import { householdLiabilityFeedback, itemLiabilityFeedback } from "./liabilitySyncFeedback";

describe("liabilitySyncFeedback", () => {
  it("treats HTTP 200 reauthorization as a consent failure, not success", () => {
    const result = itemLiabilityFeedback({
      item_id: 12,
      status: "reauthorization_required",
      observed_at: "2026-09-05T20:00:00Z",
      accounts_seen: 1,
      accounts_updated: 0,
      accounts_unchanged: 1,
      accounts_missing_liability: 0,
      warnings: [],
      message: "Additional consent is required.",
    });
    expect(result.tone).toBe("failure");
    expect(result.needsUpdateConsent).toBe(true);
    expect(result.message).toMatch(/consent/i);
  });

  it("reports partial household success when some items fail", () => {
    const result = householdLiabilityFeedback({
      household_id: 9,
      item_count: 2,
      success_count: 1,
      failed_count: 1,
      reauthorization_required_count: 0,
      accounts_updated: 2,
      items: [
        {
          item_id: 1,
          status: "success",
          observed_at: "2026-09-05T20:00:00Z",
          accounts_seen: 2,
          accounts_updated: 2,
          accounts_unchanged: 0,
          accounts_missing_liability: 0,
          warnings: [],
        },
        {
          item_id: 2,
          status: "failed",
          observed_at: "2026-09-05T20:00:00Z",
          accounts_seen: 0,
          accounts_updated: 0,
          accounts_unchanged: 0,
          accounts_missing_liability: 0,
          warnings: [],
        },
      ],
    });
    expect(result.tone).toBe("partial");
    expect(result.message).toMatch(/Updated 2 card minimums/);
  });
});
