/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { BillingStatus } from "@budget-app/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaidConnectBar } from "./PlaidConnectBar";
import { PLAID_PREMIUM_MESSAGE, PLAID_SYNC_PAUSED_MESSAGE } from "../lib/billing";

const api = vi.hoisted(() => ({
  getBillingStatus: vi.fn(),
  getPlaidMeta: vi.fn(),
  listPlaidItems: vi.fn(),
  createPlaidLinkToken: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
}));

vi.mock("@budget-app/api-client", async () => {
  const actual = await vi.importActual<typeof import("@budget-app/api-client")>(
    "@budget-app/api-client"
  );
  return {
    ...actual,
    getBillingStatus: api.getBillingStatus,
    getPlaidMeta: api.getPlaidMeta,
    listPlaidItems: api.listPlaidItems,
    createPlaidLinkToken: api.createPlaidLinkToken,
    createCheckoutSession: api.createCheckoutSession,
    createPortalSession: api.createPortalSession,
  };
});

const freeStatus: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
  entitlements: {
    plan: "FREE",
    is_premium: false,
    plaid_bank_sync: false,
    payment_planner_full: false,
    limits: {
      linked_institutions: 0,
      manual_accounts: 3,
      recurring_rules: 10,
      operational_forecast_days: 90,
      goals: 2,
    },
    usage: {
      linked_institutions: 1,
      manual_accounts: 1,
      recurring_rules: 0,
      goals: 0,
    },
  },
};

function renderBar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PlaidConnectBar householdId={1} defaultExpanded />, { wrapper });
}

describe("PlaidConnectBar entitlements", () => {
  beforeEach(() => {
    api.getBillingStatus.mockReset();
    api.getPlaidMeta.mockReset();
    api.listPlaidItems.mockReset();
    api.createPlaidLinkToken.mockReset();
    api.getBillingStatus.mockResolvedValue(freeStatus);
    api.getPlaidMeta.mockResolvedValue({ plaid_configured: true });
    api.listPlaidItems.mockResolvedValue({
      results: [
        {
          id: 9,
          institution_name: "Kept Bank",
          linked_accounts: [],
        },
      ],
    });
  });

  it("prompts Free users to upgrade instead of opening Plaid Link", async () => {
    renderBar();
    expect(await screen.findByText(PLAID_SYNC_PAUSED_MESSAGE)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Upgrade to Premium" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Link a bank" })).not.toBeInTheDocument();
    expect(PLAID_PREMIUM_MESSAGE).toMatch(/available with Premium/);
  });
});
