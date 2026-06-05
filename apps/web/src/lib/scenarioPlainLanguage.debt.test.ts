import { describe, expect, it } from "vitest";
import { buildPlanIncludes } from "./scenarioPlainLanguage";

describe("buildPlanIncludes debt payments", () => {
  it("labels transfer to credit card as debt, not expense", () => {
    const items = buildPlanIncludes(
      [],
      [
        {
          id: 1,
          scenario: 1,
          date: "2026-06-15",
          description: "Pay off Venture in full using Main Checking",
          direction: "TRANSFER",
          amount: "500",
          notes: "what_if_debt:one_time",
          account: { id: 1, name: "Main Checking", account_type: "CHECKING" } as never,
          transfer_to_account: { id: 2, name: "Venture", account_type: "CREDIT" } as never,
          category: null,
          created_at: "",
          updated_at: "",
        },
      ],
      []
    );
    expect(items[0].impactKind).toBe("debt");
    expect(items[0].actionLabel).toContain("Venture");
    expect(items[0].actionLabel).not.toContain("expense");
    expect(items[0].accountLabel).toBe("Main Checking → Venture");
  });
});
