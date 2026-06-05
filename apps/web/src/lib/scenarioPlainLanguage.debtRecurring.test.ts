import { describe, expect, it } from "vitest";
import { buildPlanIncludes } from "./scenarioPlainLanguage";

describe("buildPlanIncludes recurring debt payment", () => {
  it("shows debt strategy not expense", () => {
    const items = buildPlanIncludes(
      [],
      [],
      [],
      [
        {
          id: 1,
          scenario: 1,
          name: "Extra Venture Payment",
          account: { id: 1, name: "Main Checking", account_type: "CHECKING" } as never,
          transfer_to_account: { id: 2, name: "Venture", account_type: "CREDIT" } as never,
          direction: "TRANSFER",
          amount: "100",
          currency: "USD",
          frequency: "MONTHLY_DAY",
          interval: 1,
          day_of_month: 1,
          day_of_week: null,
          nth_week: null,
          start_date: "2026-07-01",
          end_date: null,
          category: null,
          notes: "what_if_debt_recurring",
          created_at: "",
          updated_at: "",
        },
      ]
    );
    expect(items[0].impactKind).toBe("debt");
    expect(items[0].actionLabel).toBe("Extra Venture Payment");
    expect(items[0].detailLabel).toContain("Main Checking → Venture");
    expect(items[0].detailLabel).not.toContain("expense");
  });
});
