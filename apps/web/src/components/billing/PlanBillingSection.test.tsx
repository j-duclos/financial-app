/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { BillingStatus } from "@budget-app/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PlanBillingSection from "./PlanBillingSection";
import { PREMIUM_MONTHLY_PRICE_DISPLAY } from "../../lib/billing";

const api = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError: MockApiError,
    getBillingStatus: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
  };
});

const navigation = vi.hoisted(() => ({
  redirectToExternalUrl: vi.fn(),
}));

vi.mock("@budget-app/api-client", () => api);

vi.mock("../../lib/billingDisplay", async () => {
  const actual = await vi.importActual<typeof import("../../lib/billingDisplay")>(
    "../../lib/billingDisplay"
  );
  return {
    ...actual,
    redirectToExternalUrl: navigation.redirectToExternalUrl,
  };
});

const freeStatus: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
};

const premiumStatus: BillingStatus = {
  plan: "PREMIUM",
  is_premium: true,
  status: "active",
  cancel_at_period_end: false,
  current_period_end: "2026-10-05T00:00:00Z",
  has_stripe_customer: true,
};

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<PlanBillingSection />, { wrapper });
}

describe("PlanBillingSection", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    api.getBillingStatus.mockReset();
    api.createCheckoutSession.mockReset();
    api.createPortalSession.mockReset();
    navigation.redirectToExternalUrl.mockReset();
  });

  it("shows Free plan and Premium upgrade CTA", async () => {
    api.getBillingStatus.mockResolvedValue(freeStatus);
    renderSection();
    expect(await screen.findByText("Free plan")).toBeInTheDocument();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getByText("Free plan")).toBeInTheDocument();
    expect(screen.getByText("Premium")).toBeInTheDocument();
    expect(screen.getByText(PREMIUM_MONTHLY_PRICE_DISPLAY)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade to Premium" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Manage Billing" })).not.toBeInTheDocument();
  });

  it("shows Premium and Manage Billing for an active subscription", async () => {
    api.getBillingStatus.mockResolvedValue(premiumStatus);
    renderSection();
    expect(await screen.findByText("Active")).toBeInTheDocument();
    expect(screen.getAllByText("Premium").length).toBeGreaterThan(0);
    expect(screen.getByText("Next billing date")).toBeInTheDocument();
    expect(screen.getByText("October 5, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage Billing" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Upgrade to Premium" })).not.toBeInTheDocument();
  });

  it("respects server is_premium even when Stripe status looks paid", async () => {
    api.getBillingStatus.mockResolvedValue({
      plan: "FREE",
      is_premium: false,
      status: "past_due",
      cancel_at_period_end: false,
      current_period_end: "2026-10-05T00:00:00Z",
      has_stripe_customer: true,
    });
    renderSection();
    expect(await screen.findByText("Payment issue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade to Premium" })).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
  });

  it("uses end-of-access wording when cancel_at_period_end is true", async () => {
    api.getBillingStatus.mockResolvedValue({
      ...premiumStatus,
      cancel_at_period_end: true,
    });
    renderSection();
    expect(await screen.findByText("Premium access ends")).toBeInTheDocument();
    expect(
      screen.getByText(/remain available until the end of the current billing period/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Renews/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Next billing date")).not.toBeInTheDocument();
  });

  it("calls createCheckoutSession without a price id and navigates to Stripe", async () => {
    api.getBillingStatus.mockResolvedValue(freeStatus);
    let resolveSession: (value: { url: string; session_id: string }) => void = () => undefined;
    api.createCheckoutSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve;
        })
    );
    const user = userEvent.setup();
    renderSection();
    const button = await screen.findByRole("button", { name: "Upgrade to Premium" });
    await user.click(button);
    expect(await screen.findByRole("button", { name: "Opening checkout…" })).toBeDisabled();
    expect(api.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(api.createCheckoutSession.mock.calls[0]?.length ?? 0).toBe(0);
    resolveSession({
      url: "https://checkout.stripe.com/c/pay/cs_test",
      session_id: "cs_test",
    });
    await waitFor(() => {
      expect(navigation.redirectToExternalUrl).toHaveBeenCalledWith(
        "https://checkout.stripe.com/c/pay/cs_test"
      );
    });
  });

  it("refetches billing status on a 409 instead of treating it as fatal", async () => {
    api.getBillingStatus
      .mockResolvedValueOnce(freeStatus)
      .mockResolvedValue(premiumStatus);
    api.createCheckoutSession.mockRejectedValue(new api.ApiError(409, "already subscribed"));
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Upgrade to Premium" }));
    expect(
      await screen.findByText("Your Premium subscription is already active.")
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Manage Billing" })).toBeInTheDocument();
    expect(navigation.redirectToExternalUrl).not.toHaveBeenCalled();
  });

  it("calls createPortalSession and navigates to the portal URL", async () => {
    api.getBillingStatus.mockResolvedValue(premiumStatus);
    api.createPortalSession.mockResolvedValue({
      url: "https://billing.stripe.com/p/session/test",
    });
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Manage Billing" }));
    await waitFor(() => {
      expect(api.createPortalSession).toHaveBeenCalledTimes(1);
    });
    expect(navigation.redirectToExternalUrl).toHaveBeenCalledWith(
      "https://billing.stripe.com/p/session/test"
    );
  });

  it("does not crash Settings when billing status fails", async () => {
    api.getBillingStatus.mockRejectedValue(new api.ApiError(500, "Server error"));
    renderSection();
    expect(
      await screen.findByText(/plan details could not be loaded/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plan & Billing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("shows a clean error when Stripe is not configured", async () => {
    api.getBillingStatus.mockResolvedValue(freeStatus);
    api.createCheckoutSession.mockRejectedValue(
      new api.ApiError(503, "Stripe billing is not configured. Set STRIPE_SECRET_KEY.")
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "Upgrade to Premium" }));
    expect(
      await screen.findByText("Billing is temporarily unavailable. Please try again later.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/STRIPE_SECRET_KEY/)).not.toBeInTheDocument();
  });
});
