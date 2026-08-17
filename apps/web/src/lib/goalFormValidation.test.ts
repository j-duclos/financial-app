import { describe, expect, it } from "vitest";
import { emptyGoalFundingForm } from "./goalFundingForm";
import { goalFormHasErrors, validateGoalForm } from "./goalFormValidation";

function validForm(overrides: Partial<Parameters<typeof validateGoalForm>[0]> = {}) {
  return {
    name: "House down payment",
    goal_type: "house",
    target_amount: "30000",
    target_date: "2027-12-01",
    linked_account: 4 as number | "",
    linked_credit_account: "" as number | "",
    monthly_contribution: "400",
    funding: { ...emptyGoalFundingForm },
    ...overrides,
  };
}

describe("validateGoalForm", () => {
  it("accepts a complete savings goal", () => {
    expect(goalFormHasErrors(validateGoalForm(validForm()))).toBe(false);
  });

  it("requires a goal name", () => {
    expect(validateGoalForm(validForm({ name: "  " })).name).toBe("Goal name required");
  });

  it("requires a target amount greater than zero", () => {
    expect(validateGoalForm(validForm({ target_amount: "0" })).target_amount).toMatch(
      /greater than \$0/
    );
    expect(validateGoalForm(validForm({ target_amount: "" })).target_amount).toMatch(
      /greater than \$0/
    );
  });

  it("allows an optional target date and rejects an invalid one", () => {
    expect(validateGoalForm(validForm({ target_date: "" })).target_date).toBeUndefined();
    expect(validateGoalForm(validForm({ target_date: "not-a-date" })).target_date).toBe(
      "Target date invalid"
    );
  });

  it("rejects a negative planned contribution", () => {
    expect(validateGoalForm(validForm({ monthly_contribution: "-10" })).monthly_contribution).toBe(
      "Contribution cannot be negative"
    );
  });

  it("requires a linked account for savings goals", () => {
    expect(validateGoalForm(validForm({ linked_account: "" })).linked_account).toMatch(
      /linked account/i
    );
  });

  it("does not enable paycheck auto-funding when a monthly contribution is set", () => {
    const errors = validateGoalForm(validForm({ monthly_contribution: "500" }));
    expect(errors.funding).toBeUndefined();
    expect(validForm().funding.enabled).toBe(false);
  });

  it("validates paycheck auto-funding only when enabled", () => {
    const errors = validateGoalForm(
      validForm({
        funding: { ...emptyGoalFundingForm, enabled: true, incomeRuleId: "" },
      })
    );
    expect(errors.funding).toMatch(/paycheck/i);
  });
});
