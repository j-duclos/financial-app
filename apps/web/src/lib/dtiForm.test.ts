import { describe, expect, it } from "vitest";
import type { DtiCreditCardSuggestion, DtiPayoffImpact } from "@budget-app/shared";
import {
  compareActualToTarget,
  debtRowView,
  formatDtiPercent,
  groupDtiWarnings,
  rankPayoffImpactsByPayment,
} from "./dtiDisplay";
import {
  alreadyLinkedAccountIds,
  buildDtiCalculationRequest,
  emptyProposedHousingDraft,
  normalizeMoneyInput,
  normalizePercentInput,
  normalizeProposedHousingDraft,
  subtractMoneyStrings,
  suggestionPrefill,
  sumProposedHousingDraft,
  toggleExcludedDebtItemId,
} from "./dtiForm";
import { dtiCalculationInputsKey, dtiQueryKeys } from "./dtiQueryKeys";

describe("dtiForm money normalization", () => {
  it("treats blank currency input as zero", () => {
    expect(normalizeMoneyInput("")).toEqual({ ok: true, value: "0.00" });
    expect(normalizeMoneyInput("  ")).toEqual({ ok: true, value: "0.00" });
  });

  it("rejects negative amounts and pads two decimal places", () => {
    expect(normalizeMoneyInput("-1")).toEqual({ ok: false, error: "Amount cannot be negative." });
    expect(normalizeMoneyInput("2100")).toEqual({ ok: true, value: "2100.00" });
  });

  it("sums drafted proposed housing for input presentation only", () => {
    const draft = emptyProposedHousingDraft();
    draft.principal_and_interest = "2100";
    draft.property_taxes = "250.00";
    expect(sumProposedHousingDraft(draft)).toBe("2350.00");
    const payload = normalizeProposedHousingDraft(draft);
    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.payload.homeowners_insurance).toBe("0.00");
    }
  });

  it("subtracts decimal strings in cents for presentation deltas", () => {
    expect(subtractMoneyStrings("4787.00", "3987.00")).toBe("800.00");
    expect(subtractMoneyStrings("100.00", "100.00")).toBe("0.00");
  });
});

describe("dtiForm calculate request", () => {
  it("omits proposed housing and exclusions until they are set", () => {
    expect(buildDtiCalculationRequest({
      householdId: 9,
      proposedHousing: null,
      excludedDebtItemIds: [],
    })).toEqual({ household_id: 9 });
  });

  it("sends proposed housing components and selected payoff ids", () => {
    const request = buildDtiCalculationRequest({
      householdId: 9,
      proposedHousing: { principal_and_interest: "2100.00", property_taxes: "250.00" },
      excludedDebtItemIds: [12, 4, 12],
    });
    expect(request.excluded_debt_item_ids).toEqual([4, 12]);
    expect(request.proposed_housing?.principal_and_interest).toBe("2100.00");
    expect(request.proposed_housing?.hoa_dues).toBe("0.00");
  });

  it("toggles payoff selection without mutating saved debt flags", () => {
    expect(toggleExcludedDebtItemId([4], 12)).toEqual([4, 12]);
    expect(toggleExcludedDebtItemId([4, 12], 12)).toEqual([4]);
  });
});

describe("dtiForm credit-card prefill", () => {
  it("prefills a usable suggestion as linked_account_minimum", () => {
    const suggestion: DtiCreditCardSuggestion = {
      account_id: 7,
      name: "Visa",
      effective_display_name: "Everyday Visa",
      current_balance: "2993.00",
      minimum_payment_amount: "125.00",
      minimum_payment_usable: true,
      suggested_debt_type: "credit_card",
    };
    expect(suggestionPrefill(suggestion)).toMatchObject({
      linked_account_id: 7,
      debt_type: "credit_card",
      name: "Everyday Visa",
      outstanding_balance: "2993.00",
      payment_source: "linked_account_minimum",
      included: true,
    });
  });

  it("requests a manual payment when the minimum is not usable", () => {
    const suggestion: DtiCreditCardSuggestion = {
      account_id: 8,
      name: "Store card",
      effective_display_name: "Store card",
      current_balance: "100.00",
      minimum_payment_amount: "0.00",
      minimum_payment_usable: false,
      suggested_debt_type: "credit_card",
    };
    expect(suggestionPrefill(suggestion).payment_source).toBe("manual");
  });

  it("excludes accounts already linked to another debt item", () => {
    const ids = alreadyLinkedAccountIds(
      [
        { id: 1, linked_account_id: 7 },
        { id: 2, linked_account_id: 9 },
      ],
      1
    );
    expect(ids.has(7)).toBe(false);
    expect(ids.has(9)).toBe(true);
  });
});

describe("dtiDisplay", () => {
  it("does not present null percentages as 0%", () => {
    expect(formatDtiPercent(null)).toBe("Not available");
    expect(formatDtiPercent("46.03")).toBe("46.03%");
  });

  it("compares actual DTI against the user-selected target only", () => {
    expect(compareActualToTarget("29.81", "31.00").status).toBe("within");
    expect(compareActualToTarget("29.81", "31.00").label).toBe("Within your selected target");
    expect(compareActualToTarget("49.20", "46.00").label).toContain("above your selected target");
    expect(compareActualToTarget(null, "36.00").status).toBe("unavailable");
  });

  it("presents linked cards by effective payment and months remaining", () => {
    const view = debtRowView({
      id: 3,
      household_id: 1,
      name: "Visa",
      debt_type: "credit_card",
      monthly_payment: "40.00",
      payment_source: "linked_account_minimum",
      effective_monthly_payment: "125.00",
      outstanding_balance: "2993.00",
      linked_account_id: 7,
      linked_account: {
        id: 7,
        name: "Visa",
        effective_display_name: "Everyday Visa",
        account_type: "CREDIT",
        status: "active",
        minimum_payment_amount: "125.00",
      },
      included: true,
      months_remaining: 18,
      notes: "",
      position: 0,
      created_at: "",
      updated_at: "",
    });
    expect(view.effectivePaymentLabel).toContain("125");
    expect(view.effectivePaymentLabel).not.toContain("40");
    expect(view.paymentSource).toBe("Synced from account minimum");
    expect(view.showLinkedMinimumSync).toBe(true);
    expect(view.monthsRemainingLabel).toBe("18 months remaining");
    expect(view.linkedAccountLabel).toBe("Everyday Visa");
  });

  it("ranks payoff impact by monthly payment, not balance", () => {
    const ranked = rankPayoffImpactsByPayment([
      impact(1, "Low pay", "50.00"),
      impact(2, "High pay", "400.00"),
    ]);
    expect(ranked.map((row) => row.debt_item_id)).toEqual([2, 1]);
  });

  it("groups row warnings separately from page warnings", () => {
    const grouped = groupDtiWarnings([
      { code: "gross_income_required", message: "Need income" },
      { code: "linked_account_inactive", message: "Inactive", debt_item_id: 12 },
      { code: "possible_housing_double_count", message: "Housing" },
    ]);
    expect(grouped.page.map((w) => w.code)).toEqual(["gross_income_required"]);
    expect(grouped.byDebtId[12]?.[0]?.code).toBe("linked_account_inactive");
    expect(grouped.housing[0]?.code).toBe("possible_housing_double_count");
  });
});

describe("dtiQueryKeys", () => {
  it("keeps combined payoff keys distinct from baseline calculation keys", () => {
    const baseline = dtiQueryKeys.calculation(1, dtiCalculationInputsKey(null, []));
    const combined = dtiQueryKeys.calculation(1, dtiCalculationInputsKey(null, [12]));
    expect(baseline).not.toEqual(combined);
    expect(dtiQueryKeys.profile(1)).toEqual(["dti", "profile", 1]);
  });
});

describe("percent input", () => {
  it("rejects 0 and values above 100", () => {
    expect(normalizePercentInput("0").ok).toBe(false);
    expect(normalizePercentInput("100.01").ok).toBe(false);
    expect(normalizePercentInput("36")).toEqual({ ok: true, value: "36.00" });
    expect(normalizePercentInput("", { optional: true })).toEqual({ ok: true, value: null });
  });
});

function impact(id: number, name: string, payment: string): DtiPayoffImpact {
  return {
    debt_item_id: id,
    name,
    effective_monthly_payment: payment,
    current_back_end_dti: "46.03",
    back_end_dti_after_payoff: "40.00",
    dti_reduction_percentage_points: "6.03",
    additional_housing_capacity_at_target: payment,
    linked_account_id: null,
    warnings: [],
  };
}
