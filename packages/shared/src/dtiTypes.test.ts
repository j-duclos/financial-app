import { describe, expect, it } from "vitest";
import type {
  DtiCalculationRequest,
  DtiCalculationResponse,
  DtiCreditCardSuggestion,
  DtiDebtItem,
  DtiDebtItemWritePayload,
  DtiIncomeSource,
  DtiIncomeSourceWritePayload,
  DtiPayoffImpact,
  DtiProfile,
  DtiProfileWritePayload,
  DtiProposedHousingInput,
} from "./types";
import {
  DTI_DEBT_TYPES,
  DTI_INCOME_TYPES,
  DTI_PAYMENT_SOURCES,
  DTI_STUDENT_LOAN_PAYMENT_METHODS,
  DTI_STUDENT_LOAN_STATUSES,
} from "./types";

describe("DTI shared types", () => {
  it("uses organizational income and debt labels without an expense debt type", () => {
    expect(DTI_INCOME_TYPES).toContain("employment");
    expect(DTI_DEBT_TYPES).toContain("auto_loan");
    expect(DTI_DEBT_TYPES).not.toContain("expense");
    expect(DTI_PAYMENT_SOURCES).toEqual(["manual", "linked_account_minimum"]);
    expect(DTI_STUDENT_LOAN_STATUSES).toEqual([
      "repayment",
      "deferred",
      "forbearance",
      "unknown",
    ]);
    expect(DTI_STUDENT_LOAN_PAYMENT_METHODS).toEqual([
      "manual",
      "fha_deferred_balance_percent",
    ]);
  });

  it("represents money and percents as decimal strings", () => {
    const profile: DtiProfile = {
      id: null,
      household_id: 1,
      target_back_end_dti_percent: "36.00",
      target_front_end_dti_percent: "28.00",
      current_housing_payment: "0.00",
      current_housing_label: "",
      include_current_housing_in_current_dti: true,
      is_saved: false,
      created_at: null,
      updated_at: null,
    };
    const write: DtiProfileWritePayload = {
      target_back_end_dti_percent: "47.00",
      current_housing_payment: "3100.00",
    };
    expect(typeof profile.target_back_end_dti_percent).toBe("string");
    expect(typeof write.current_housing_payment).toBe("string");
  });

  it("accepts income and debt write payloads with string amounts", () => {
    const income: DtiIncomeSourceWritePayload = {
      household_id: 1,
      name: "Salary",
      gross_monthly_amount: "5400.00",
      income_type: "employment",
      included: true,
    };
    const debt: DtiDebtItemWritePayload = {
      household_id: 1,
      name: "Auto",
      debt_type: "auto_loan",
      monthly_payment: "412.00",
      payment_source: "manual",
    };
    const source: DtiIncomeSource = {
      id: 3,
      household_id: 1,
      name: "Salary",
      gross_monthly_amount: "5400.00",
      income_type: "employment",
      included: true,
      notes: "",
      position: 1,
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-05T00:00:00Z",
    };
    const item: DtiDebtItem = {
      id: 12,
      household_id: 1,
      name: "Credit Card",
      debt_type: "credit_card",
      monthly_payment: "100.00",
      payment_source: "linked_account_minimum",
      effective_monthly_payment: "125.00",
      outstanding_balance: "2993.00",
      linked_account_id: 7,
      linked_account: {
        id: 7,
        name: "Visa",
        effective_display_name: "Visa",
        account_type: "CREDIT",
        status: "active",
        minimum_payment_amount: "125.00",
      },
      included: true,
      months_remaining: null,
      notes: "",
      position: 1,
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-05T00:00:00Z",
    };
    const studentWrite: DtiDebtItemWritePayload = {
      household_id: 1,
      name: "Federal student loans",
      debt_type: "student_loan",
      outstanding_balance: "109058.00",
      payment_source: "manual",
      student_loan_status: "deferred",
      student_loan_payment_method: "fha_deferred_balance_percent",
    };
    const studentItem: DtiDebtItem = {
      id: 30,
      household_id: 1,
      name: "Federal student loans",
      debt_type: "student_loan",
      monthly_payment: "0.00",
      payment_source: "manual",
      student_loan_status: "deferred",
      student_loan_payment_method: "fha_deferred_balance_percent",
      effective_monthly_payment: "545.29",
      outstanding_balance: "109058.00",
      payment_calculation: {
        method: "fha_deferred_balance_percent",
        label: "FHA deferred/zero-payment estimate",
        balance: "109058.00",
        percentage: "0.50",
        multiplier: "0.005",
        calculated_monthly_payment: "545.29",
      },
      linked_account_id: null,
      linked_account: null,
      included: true,
      months_remaining: null,
      notes: "",
      position: 2,
      created_at: "2026-09-05T00:00:00Z",
      updated_at: "2026-09-05T00:00:00Z",
    };
    expect(income.gross_monthly_amount).toBe("5400.00");
    expect(debt.monthly_payment).toBe("412.00");
    expect(source.included).toBe(true);
    expect(item.effective_monthly_payment).toBe("125.00");
    expect(studentWrite.student_loan_payment_method).toBe("fha_deferred_balance_percent");
    expect(studentItem.payment_calculation?.multiplier).toBe("0.005");
    expect(typeof studentItem.effective_monthly_payment).toBe("string");
  });

  it("allows null DTI percentages when income is missing", () => {
    const request: DtiCalculationRequest = { household_id: 1 };
    const housing: DtiProposedHousingInput = {
      principal_and_interest: "2100.00",
      property_taxes: "250.00",
    };
    const impact: DtiPayoffImpact = {
      debt_item_id: 12,
      name: "Auto",
      effective_monthly_payment: "412.00",
      current_back_end_dti: null,
      back_end_dti_after_payoff: null,
      dti_reduction_percentage_points: null,
      additional_housing_capacity_at_target: "412.00",
      linked_account_id: null,
      warnings: [],
    };
    const suggestion: DtiCreditCardSuggestion = {
      account_id: 7,
      name: "Visa",
      effective_display_name: "Visa",
      current_balance: "2993.00",
      minimum_payment_amount: "125.00",
      minimum_payment_usable: true,
      suggested_debt_type: "credit_card",
    };
    const response: DtiCalculationResponse = {
      household_id: 1,
      status: "gross_income_required",
      inputs: {
        gross_monthly_income: "0.00",
        current_housing_payment: "0.00",
        non_housing_monthly_debt: "0.00",
        target_back_end_dti_percent: "36.00",
        target_front_end_dti_percent: "28.00",
      },
      current: {
        front_end_dti_percent: null,
        back_end_dti_percent: null,
        total_monthly_obligations: "0.00",
        remaining_capacity_at_target: "0.00",
        amount_over_target: "0.00",
      },
      proposed: null,
      capacity: {
        target_total_obligation_capacity: "0.00",
        max_proposed_housing_payment_at_target: "0.00",
      },
      income_sources: [],
      debt_items: [],
      payoff_impacts: [impact],
      credit_card_suggestions: [suggestion],
      warnings: [{ code: "gross_income_required", message: "Included gross monthly income is required." }],
      disclaimer: "Planning estimate only. Lender calculations and qualifying rules vary.",
    };
    expect(request.household_id).toBe(1);
    expect(housing.principal_and_interest).toBe("2100.00");
    expect(response.current.front_end_dti_percent).toBeNull();
    expect(response.status).toBe("gross_income_required");
  });
});
