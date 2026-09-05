import { describe, expect, it } from "vitest";
import { emptyProposedHousingDraft } from "./dtiForm";
import {
  emptyPurchaseEstimateDraft,
  isImplausibleMonthlyHousing,
  normalizePurchaseEstimateDraft,
} from "./dtiProposedHome";

describe("purchase estimate draft", () => {
  it("normalizes a purchase payload without computing principal and interest", () => {
    const draft = emptyPurchaseEstimateDraft();
    draft.purchase_price = "400000";
    draft.down_payment_type = "percent";
    draft.down_payment_value = "3.50";
    draft.annual_interest_rate = "6.50";
    draft.loan_term_years = "15";
    draft.annual_property_taxes = "2500";
    draft.annual_homeowners_insurance = "1440";
    draft.monthly_mortgage_insurance = "180";
    draft.monthly_hoa_dues = "67";
    const result = normalizePurchaseEstimateDraft(draft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({
        purchase_price: "400000.00",
        down_payment_type: "percent",
        down_payment_value: "3.50",
        annual_interest_rate: "6.50",
        loan_term_years: 15,
        annual_property_taxes: "2500.00",
        monthly_hoa_dues: "67.00",
      });
      expect(result.payload).not.toHaveProperty("principal_and_interest");
    }
  });

  it("rejects a down payment above the purchase price", () => {
    const draft = emptyPurchaseEstimateDraft();
    draft.purchase_price = "100000";
    draft.down_payment_type = "dollars";
    draft.down_payment_value = "100000.01";
    const result = normalizePurchaseEstimateDraft(draft);
    expect(result.ok).toBe(false);
  });
});

describe("monthly plausibility", () => {
  it("warns when a monthly component is several times income", () => {
    const payload = {
      ...emptyProposedHousingDraft(),
      principal_and_interest: "400000.00",
    };
    expect(isImplausibleMonthlyHousing(payload, "5400.00")).toBe(true);
    expect(isImplausibleMonthlyHousing({ ...emptyProposedHousingDraft(), principal_and_interest: "2100.00" }, "5400.00")).toBe(false);
  });
});
