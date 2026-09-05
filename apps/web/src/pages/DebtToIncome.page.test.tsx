/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  DtiCalculationRequest,
  DtiCalculationResponse,
  DtiCreditCardSuggestion,
  DtiDebtItem,
  DtiIncomeSource,
  DtiProfile,
} from "@budget-app/shared";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import DebtToIncome from "./DebtToIncome";

const api = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listHouseholds: vi.fn(),
  getDtiProfile: vi.fn(),
  listDtiIncomeSources: vi.fn(),
  listDtiDebtItems: vi.fn(),
  listDtiCreditCardSuggestions: vi.fn(),
  calculateDti: vi.fn(),
  createDtiIncomeSource: vi.fn(),
  updateDtiIncomeSource: vi.fn(),
  deleteDtiIncomeSource: vi.fn(),
  createDtiDebtItem: vi.fn(),
  updateDtiDebtItem: vi.fn(),
  deleteDtiDebtItem: vi.fn(),
  saveDtiProfile: vi.fn(),
}));

vi.mock("@budget-app/api-client", () => api);

const profile: DtiProfile = {
  id: 1,
  household_id: 1,
  target_back_end_dti_percent: "36.00",
  target_front_end_dti_percent: "28.00",
  current_housing_payment: "1800.00",
  current_housing_label: "Rent",
  include_current_housing_in_current_dti: true,
  is_saved: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const salary: DtiIncomeSource = {
  id: 11,
  household_id: 1,
  name: "Salary",
  gross_monthly_amount: "5400.00",
  income_type: "employment",
  included: true,
  notes: "",
  position: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const autoLoan: DtiDebtItem = {
  id: 21,
  household_id: 1,
  name: "Auto loan",
  debt_type: "auto_loan",
  monthly_payment: "412.00",
  payment_source: "manual",
  effective_monthly_payment: "412.00",
  outstanding_balance: "9000.00",
  linked_account_id: null,
  linked_account: null,
  included: true,
  months_remaining: 24,
  notes: "",
  position: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const visaCard: DtiDebtItem = {
  id: 22,
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
  months_remaining: null,
  notes: "",
  position: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const usableSuggestion: DtiCreditCardSuggestion = {
  account_id: 8,
  name: "Store card",
  effective_display_name: "Store card",
  current_balance: "400.00",
  minimum_payment_amount: "25.00",
  minimum_payment_usable: true,
  suggested_debt_type: "credit_card",
};

const unusableSuggestion: DtiCreditCardSuggestion = {
  account_id: 9,
  name: "No-min card",
  effective_display_name: "No-min card",
  current_balance: "100.00",
  minimum_payment_amount: "0.00",
  minimum_payment_usable: false,
  suggested_debt_type: "credit_card",
};

function bucket(front: string | null, back: string | null, total: string, housingTotal?: string) {
  return {
    front_end_dti_percent: front,
    back_end_dti_percent: back,
    total_monthly_obligations: total,
    remaining_capacity_at_target: "0.00",
    amount_over_target: "0.00",
    ...(housingTotal
      ? {
          housing: {
            principal_and_interest: "2100.00",
            property_taxes: "250.00",
            homeowners_insurance: "0.00",
            mortgage_insurance: "0.00",
            hoa_dues: "0.00",
            other_required_housing_costs: "0.00",
            total: housingTotal,
          },
        }
      : {}),
  };
}

function calculation(overrides: Partial<DtiCalculationResponse> = {}): DtiCalculationResponse {
  return {
    household_id: 1,
    status: "calculated",
    inputs: {
      gross_monthly_income: "5400.00",
      current_housing_payment: "1800.00",
      non_housing_monthly_debt: "537.00",
      target_back_end_dti_percent: "36.00",
      target_front_end_dti_percent: "28.00",
    },
    current: bucket("33.33", "46.03", "2337.00"),
    proposed: null,
    capacity: {
      target_total_obligation_capacity: "1944.00",
      max_proposed_housing_payment_at_target: "1407.00",
    },
    income_sources: [salary],
    debt_items: [autoLoan, visaCard],
    payoff_impacts: [
      {
        debt_item_id: 21,
        name: "Auto loan",
        effective_monthly_payment: "412.00",
        current_back_end_dti: "46.03",
        back_end_dti_after_payoff: "38.43",
        dti_reduction_percentage_points: "7.60",
        additional_housing_capacity_at_target: "412.00",
        linked_account_id: null,
        warnings: [],
      },
      {
        debt_item_id: 22,
        name: "Visa",
        effective_monthly_payment: "125.00",
        current_back_end_dti: "46.03",
        back_end_dti_after_payoff: "43.72",
        dti_reduction_percentage_points: "2.31",
        additional_housing_capacity_at_target: "125.00",
        linked_account_id: 7,
        warnings: [],
      },
    ],
    warnings: [],
    disclaimer: "Planning estimate only. Lender calculations and qualifying rules vary.",
    ...overrides,
  };
}

const currentCalc = calculation();
const proposedCalc = calculation({
  proposed: bucket("43.52", "49.25", "2887.00", "2600.00"),
});
const combinedCurrentCalc = calculation({
  current: bucket("33.33", "38.43", "1925.00"),
  capacity: {
    target_total_obligation_capacity: "1944.00",
    max_proposed_housing_payment_at_target: "1819.00",
  },
});
const combinedProposedCalc = calculation({
  current: bucket("33.33", "38.43", "1925.00"),
  proposed: bucket("43.52", "41.20", "2475.00", "2600.00"),
  capacity: {
    target_total_obligation_capacity: "1944.00",
    max_proposed_housing_payment_at_target: "1819.00",
  },
});

function mockHappyPath(options?: {
  incomes?: DtiIncomeSource[];
  debts?: DtiDebtItem[];
  suggestions?: DtiCreditCardSuggestion[];
  calc?: DtiCalculationResponse;
}) {
  api.getProfile.mockResolvedValue({
    id: 1,
    username: "pat",
    display_name: "Pat",
    default_household: 1,
    default_account: null,
    default_forecast_days: 90,
  });
  api.listHouseholds.mockResolvedValue([
    { id: 1, name: "Home", created_at: "", updated_at: "" },
  ]);
  api.getDtiProfile.mockResolvedValue(profile);
  api.listDtiIncomeSources.mockResolvedValue(options?.incomes ?? [salary]);
  api.listDtiDebtItems.mockResolvedValue(options?.debts ?? [autoLoan, visaCard]);
  api.listDtiCreditCardSuggestions.mockResolvedValue(options?.suggestions ?? []);
  api.calculateDti.mockImplementation(async (payload: DtiCalculationRequest) => {
    if (options?.calc) return options.calc;
    if (payload.excluded_debt_item_ids?.length) {
      return payload.proposed_housing ? combinedProposedCalc : combinedCurrentCalc;
    }
    if (payload.proposed_housing) return proposedCalc;
    return currentCalc;
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/debt-to-income"]}>
        <DebtToIncome />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("DebtToIncome page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
    mockHappyPath();
  });

  it("shows a loading state before calculation data and does not render 0%", async () => {
    const pending: Array<(value: DtiCalculationResponse) => void> = [];
    api.calculateDti.mockImplementation(
      () => new Promise<DtiCalculationResponse>((resolve) => {
        pending.push(resolve);
      })
    );
    renderPage();
    expect(await screen.findByLabelText("Loading DTI summary")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    await act(async () => {
      pending.forEach((resolve) => resolve(currentCalc));
    });
    expect(await screen.findByRole("heading", { name: "DTI summary" })).toBeInTheDocument();
  });

  it("directs zero-income responses to add income without treating 0% as valid", async () => {
    mockHappyPath({
      incomes: [],
      calc: calculation({
        status: "gross_income_required",
        current: bucket(null, null, "1800.00"),
        warnings: [{ code: "gross_income_required", message: "Need income" }],
      }),
    });
    renderPage();
    expect(
      await screen.findByText("Add at least one included gross monthly income source to calculate DTI.")
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Add income source" }).length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  });

  it("shows Retry when a primary query fails", async () => {
    api.getDtiProfile.mockRejectedValue(new Error("server down"));
    renderPage();
    expect(await screen.findByText("Could not load DTI data.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("sends normalized proposed housing and displays the backend total and change", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "DTI summary" });
    await user.type(screen.getByLabelText("Principal and interest"), "2100");
    await user.type(screen.getByLabelText("Property taxes"), "250");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await waitFor(() => {
      expect(api.calculateDti).toHaveBeenCalledWith(
        expect.objectContaining({
          household_id: 1,
          proposed_housing: {
            principal_and_interest: "2100.00",
            property_taxes: "250.00",
            homeowners_insurance: "0.00",
            mortgage_insurance: "0.00",
            hoa_dues: "0.00",
            other_required_housing_costs: "0.00",
          },
        })
      );
    });
    await waitFor(() => {
      expect(screen.getAllByText(/2,600/).length).toBeGreaterThan(0);
    });
    expect(screen.getByText("+3.22 percentage points")).toBeInTheDocument();
    expect(screen.getByText("46.03% → 49.25%")).toBeInTheDocument();
    expect(screen.getByText("Proposed back-end DTI vs your selected target")).toBeInTheDocument();
    expect(screen.getByText("Proposed home")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear proposed home" }));
    expect(await screen.findByText("Current back-end DTI vs your selected target")).toBeInTheDocument();
    expect(screen.queryByText("Proposed back-end DTI vs your selected target")).not.toBeInTheDocument();
  });

  it("preserves proposed draft fields when calculation fails", async () => {
    const user = userEvent.setup();
    api.calculateDti.mockImplementation(async (payload: DtiCalculationRequest) => {
      if (payload.proposed_housing) throw new Error("calc failed");
      return currentCalc;
    });
    renderPage();
    await screen.findByRole("heading", { name: "DTI summary" });
    const principal = screen.getByLabelText("Principal and interest");
    await user.type(principal, "2100");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    expect(await screen.findByText("Could not calculate the proposed home payment.")).toBeInTheDocument();
    expect(principal).toHaveValue("2100");
  });

  it("toggles income through the API and keeps the persisted checkbox on failure", async () => {
    const user = userEvent.setup();
    api.updateDtiIncomeSource.mockRejectedValue(new Error("cannot toggle"));
    renderPage();
    const salaryName = await screen.findAllByText("Salary");
    const row = salaryName[0].closest("li");
    expect(row).toBeTruthy();
    const checkbox = within(row as HTMLElement).getByRole("checkbox");
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(api.updateDtiIncomeSource).toHaveBeenCalledWith(11, { included: false });
    expect(await screen.findByText("Could not update income inclusion.")).toBeInTheDocument();
    expect(checkbox).toBeChecked();
  });

  it("toggles debt through the API and shows an error on failure", async () => {
    const user = userEvent.setup();
    api.updateDtiDebtItem.mockRejectedValue(new Error("cannot toggle debt"));
    renderPage();
    await screen.findAllByText("Auto loan");
    const checkbox = screen.getAllByRole("checkbox", { name: "Include in calculation" })[1];
    await user.click(checkbox);
    expect(api.updateDtiDebtItem).toHaveBeenCalledWith(21, { included: false });
    expect(await screen.findByText("Could not update debt inclusion.")).toBeInTheDocument();
  });

  it("prevents double delete submission and leaves the row visible on failure", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    api.deleteDtiIncomeSource.mockImplementation(
      () =>
        new Promise((_, reject) => {
          finish = () => reject(new Error("delete failed"));
        })
    );
    renderPage();
    const salaryName = await screen.findAllByText("Salary");
    const row = salaryName[0].closest("li") as HTMLElement;
    const del = within(row).getByRole("button", { name: "Delete" });
    await user.click(del);
    await user.click(del);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(api.deleteDtiIncomeSource).toHaveBeenCalledTimes(1);
    finish();
    expect(await screen.findByText("Could not delete income source.")).toBeInTheDocument();
    expect(screen.getByText("Salary")).toBeInTheDocument();
  });

  it("shows linked-card effective payment rather than a stale manual amount", async () => {
    renderPage();
    expect(await screen.findAllByText("Everyday Visa")).not.toHaveLength(0);
    expect(screen.getAllByText(/125\.00/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$40\.00/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Synced from account minimum/).length).toBeGreaterThan(0);
  });

  it("requires confirmation before creating a suggested card", async () => {
    const user = userEvent.setup();
    mockHappyPath({ suggestions: [usableSuggestion] });
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: "Add to DTI" }))[0]);
    expect(api.createDtiDebtItem).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "Add debt obligation" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Store card");
  });

  it("requests a manual payment when a suggested minimum is unusable", async () => {
    const user = userEvent.setup();
    mockHappyPath({ suggestions: [unusableSuggestion] });
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: "Add to DTI" }))[0]);
    expect(
      await screen.findByText(/This card has no usable minimum payment/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Monthly payment")).toBeInTheDocument();
  });

  it("sends selected payoff IDs without changing saved included flags", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Debt payoff impact" });
    await user.click(screen.getByRole("checkbox", { name: "Model Auto loan as paid off" }));
    await waitFor(() => {
      expect(api.calculateDti).toHaveBeenCalledWith(
        expect.objectContaining({ excluded_debt_item_ids: [21] })
      );
    });
    await user.click(screen.getByRole("checkbox", { name: "Model Visa as paid off" }));
    await waitFor(() => {
      expect(api.calculateDti).toHaveBeenCalledWith(
        expect.objectContaining({ excluded_debt_item_ids: [21, 22] })
      );
    });
    expect(api.updateDtiDebtItem).not.toHaveBeenCalled();
    expect(api.deleteDtiDebtItem).not.toHaveBeenCalled();
    expect(await screen.findByText("Current back-end DTI after selected payoffs")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear selected payoffs" }));
    await waitFor(() => {
      expect(screen.queryByText("Current back-end DTI after selected payoffs")).not.toBeInTheDocument();
    });
  });

  it("uses combined.proposed when proposed housing is active", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "DTI summary" });
    await user.type(screen.getByLabelText("Principal and interest"), "2100");
    await user.click(screen.getByRole("button", { name: "Calculate" }));
    await screen.findByText("Proposed home");
    await user.click(screen.getByRole("checkbox", { name: "Model Auto loan as paid off" }));
    expect(await screen.findByText("Proposed back-end DTI before selected payoffs")).toBeInTheDocument();
    expect(screen.getByText("Proposed back-end DTI after selected payoffs")).toBeInTheDocument();
    expect(screen.getByText("41.20%")).toBeInTheDocument();
  });

  it("keeps the calculator usable when credit-card suggestions fail and retries refetch", async () => {
    const user = userEvent.setup();
    api.listDtiCreditCardSuggestions.mockRejectedValueOnce(new Error("suggestions down"));
    api.listDtiCreditCardSuggestions.mockResolvedValueOnce([usableSuggestion]);
    renderPage();
    expect(await screen.findByRole("heading", { name: "DTI summary" })).toBeInTheDocument();
    expect(screen.getByText("Could not load credit-card suggestions.")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Retry" }).at(-1)!);
    expect(await screen.findByText("Store card")).toBeInTheDocument();
  });

  it("moves focus into a modal, traps tab, closes on Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = (await screen.findAllByRole("button", { name: "Add income source" }))[0];
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Add income source" });
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Tab}");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("associates field errors with aria-describedby", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole("button", { name: "Add income source" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add income source" });
    await user.click(within(dialog).getByRole("button", { name: "Add income source" }));
    const name = within(await screen.findByRole("dialog", { name: "Add income source" })).getByLabelText(
      "Name"
    );
    expect(name).toHaveAttribute("aria-invalid", "true");
    const describedBy = name.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/Name cannot be blank/);
  });
});
