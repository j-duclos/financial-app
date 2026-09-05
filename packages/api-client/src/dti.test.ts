import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateDti,
  createDtiDebtItem,
  createDtiIncomeSource,
  deleteDtiDebtItem,
  deleteDtiIncomeSource,
  getDtiProfile,
  listDtiCreditCardSuggestions,
  listDtiDebtItems,
  listDtiIncomeSources,
  saveDtiProfile,
  updateDtiDebtItem,
  updateDtiIncomeSource,
} from "./api";
import { ApiError, configureApiClient } from "./config";
import type {
  DtiCalculationResponse,
  DtiCreditCardSuggestion,
  DtiDebtItem,
  DtiIncomeSource,
  DtiProfile,
} from "@budget-app/shared";

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

const profile: DtiProfile = {
  id: 1,
  household_id: 9,
  target_back_end_dti_percent: "36.00",
  target_front_end_dti_percent: "28.00",
  current_housing_payment: "3100.00",
  current_housing_label: "Rent",
  include_current_housing_in_current_dti: true,
  is_saved: true,
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
};

const income: DtiIncomeSource = {
  id: 3,
  household_id: 9,
  name: "Salary",
  gross_monthly_amount: "5400.00",
  income_type: "employment",
  included: true,
  notes: "",
  position: 1,
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
};

const debt: DtiDebtItem = {
  id: 12,
  household_id: 9,
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

const calculation: DtiCalculationResponse = {
  household_id: 9,
  status: "calculated",
  inputs: {
    gross_monthly_income: "10400.00",
    current_housing_payment: "3100.00",
    non_housing_monthly_debt: "1687.00",
    target_back_end_dti_percent: "47.00",
    target_front_end_dti_percent: "31.00",
  },
  current: {
    front_end_dti_percent: "29.81",
    back_end_dti_percent: "46.03",
    total_monthly_obligations: "4787.00",
    remaining_capacity_at_target: "101.00",
    amount_over_target: "0.00",
  },
  proposed: null,
  capacity: {
    target_total_obligation_capacity: "4888.00",
    max_proposed_housing_payment_at_target: "3201.00",
  },
  income_sources: [],
  debt_items: [],
  payoff_impacts: [],
  warnings: [],
  disclaimer: "Planning estimate only. Lender calculations and qualifying rules vary.",
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

describe("DTI API client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    configureApiClient({ baseUrl: "http://test.local" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the household DTI profile", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, profile));
    vi.stubGlobal("fetch", fetchMock);
    const result = await getDtiProfile(9);
    expect(result.household_id).toBe(9);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/affordability/dti/profile/?household_id=9"
    );
  });

  it("PUTs profile updates without saving calculation overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, profile));
    vi.stubGlobal("fetch", fetchMock);
    await saveDtiProfile(9, { current_housing_payment: "3100.00" });
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      current_housing_payment: "3100.00",
    });
  });

  it("lists, creates, updates, and deletes income sources", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [income]))
      .mockResolvedValueOnce(jsonResponse(201, income))
      .mockResolvedValueOnce(jsonResponse(200, { ...income, included: false }))
      .mockResolvedValueOnce({ status: 204, ok: true, text: async () => "" } as Response);
    vi.stubGlobal("fetch", fetchMock);
    await listDtiIncomeSources(9);
    await createDtiIncomeSource({
      household_id: 9,
      name: "Salary",
      gross_monthly_amount: "5400.00",
    });
    await updateDtiIncomeSource(3, { included: false });
    await deleteDtiIncomeSource(3);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/affordability/dti/income-sources/?household_id=9"
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("DELETE");
  });

  it("lists, creates, updates, and deletes debt items", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, [debt]))
      .mockResolvedValueOnce(jsonResponse(201, debt))
      .mockResolvedValueOnce(jsonResponse(200, debt))
      .mockResolvedValueOnce({ status: 204, ok: true, text: async () => "" } as Response);
    vi.stubGlobal("fetch", fetchMock);
    await listDtiDebtItems(9);
    await createDtiDebtItem({
      household_id: 9,
      name: "Credit Card",
      debt_type: "credit_card",
      payment_source: "linked_account_minimum",
      linked_account_id: 7,
    });
    await updateDtiDebtItem(12, { included: true });
    await deleteDtiDebtItem(12);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/affordability/dti/debt-items/?household_id=9"
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("DELETE");
  });

  it("POSTs a calculate payload and returns planning results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, calculation));
    vi.stubGlobal("fetch", fetchMock);
    const result = await calculateDti({
      household_id: 9,
      target_back_end_dti_percent: "47.00",
      excluded_debt_item_ids: [12],
    });
    expect(result.status).toBe("calculated");
    expect(result.current.front_end_dti_percent).toBe("29.81");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/affordability/dti/calculate/");
  });

  it("lists credit-card suggestions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [suggestion]));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listDtiCreditCardSuggestions(9);
    expect(result[0]?.account_id).toBe(7);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/affordability/dti/credit-card-suggestions/?household_id=9"
    );
  });

  it("surfaces calculate errors as ApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { detail: "Invalid." }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(calculateDti({ household_id: 9 })).rejects.toBeInstanceOf(ApiError);
  });
});
