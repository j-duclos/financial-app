import { describe, expect, it } from "vitest";
import {
  buildBucketFundingPayload,
  estimatePaycheckContributionLabel,
  goalFundingFormFromAllocation,
  validateGoalFundingForm,
} from "./goalFundingForm";

describe("goalFundingForm", () => {
  it("builds fixed amount payload when enabled", () => {
    expect(
      buildBucketFundingPayload(
        {
          enabled: true,
          incomeRuleId: 5,
          amountMode: "fixed",
          fixedAmount: "400",
          percent: "",
        },
        "300"
      )
    ).toEqual({
      auto_fund_enabled: true,
      income_rule_id: 5,
      fixed_amount: "400",
    });
  });

  it("clears allocation when disabled", () => {
    expect(
      buildBucketFundingPayload(
        {
          enabled: false,
          incomeRuleId: 5,
          amountMode: "fixed",
          fixedAmount: "400",
          percent: "",
        },
        "300"
      )
    ).toEqual({ auto_fund_enabled: false, clear_allocation: true });
  });

  it("hydrates from allocation", () => {
    const form = goalFundingFormFromAllocation(
      true,
      { rule: 2, fixed_amount: "250.00", percent: null },
      "400"
    );
    expect(form.incomeRuleId).toBe(2);
    expect(form.fixedAmount).toBe("250.00");
    expect(form.enabled).toBe(true);
  });

  it("summarizes configured paycheck amount using the selected rule schedule", () => {
    const weekly = {
      id: 9,
      frequency: "WEEKLY",
      amount: "1835.50",
      currency: "USD",
      name: "Paycheck",
    };
    expect(
      estimatePaycheckContributionLabel(
        {
          enabled: true,
          incomeRuleId: 9,
          amountMode: "fixed",
          fixedAmount: "183.55",
          percent: "",
        },
        "400",
        [weekly as never]
      )
    ).toBe("$183.55 per week");
    expect(
      estimatePaycheckContributionLabel(
        {
          enabled: false,
          incomeRuleId: 9,
          amountMode: "fixed",
          fixedAmount: "183.55",
          percent: "",
        },
        "400",
        [weekly as never]
      )
    ).toBeNull();
  });

  it("validates enabled funding requires income rule", () => {
    expect(
      validateGoalFundingForm(
        {
          enabled: true,
          incomeRuleId: "",
          amountMode: "fixed",
          fixedAmount: "100",
          percent: "",
        },
        "0"
      )
    ).toMatch(/Select a paycheck/);
  });
});
