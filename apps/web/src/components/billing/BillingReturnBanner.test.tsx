/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { BillingStatus } from "@budget-app/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillingReturnBanner from "./BillingReturnBanner";
import {
  CHECKOUT_CANCELED_MESSAGE,
  CHECKOUT_CONFIRMING_MESSAGE,
  CHECKOUT_STILL_CONFIRMING_MESSAGE,
  PREMIUM_ACTIVE_MESSAGE,
} from "../../lib/billing";

const api = vi.hoisted(() => ({
  getBillingStatus: vi.fn(),
}));

vi.mock("@budget-app/api-client", () => api);

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

function renderBanner(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<BillingReturnBanner />, { wrapper });
}

describe("BillingReturnBanner", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    api.getBillingStatus.mockReset();
  });

  it("does not set Premium from billing=success; it waits for server state", async () => {
    api.getBillingStatus.mockResolvedValue(freeStatus);
    renderBanner("/profile?billing=success&session_id=cs_test");
    expect(await screen.findByText(CHECKOUT_CONFIRMING_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(PREMIUM_ACTIVE_MESSAGE)).not.toBeInTheDocument();
    expect(screen.queryByText("Premium")).not.toBeInTheDocument();
  });

  it("shows Premium is active after the server reports is_premium", async () => {
    api.getBillingStatus
      .mockResolvedValueOnce(freeStatus)
      .mockResolvedValue(premiumStatus);
    renderBanner("/profile?billing=success");
    expect(await screen.findByText(CHECKOUT_CONFIRMING_MESSAGE)).toBeInTheDocument();
    expect(
      await screen.findByText(PREMIUM_ACTIVE_MESSAGE, {}, { timeout: 4000 })
    ).toBeInTheDocument();
  });

  it("explains confirmation is still pending after bounded retries", async () => {
    vi.useFakeTimers();
    api.getBillingStatus.mockResolvedValue(freeStatus);
    renderBanner("/profile?billing=success");
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        await Promise.resolve();
      }
    });
    expect(screen.getByText(CHECKOUT_CONFIRMING_MESSAGE)).toBeInTheDocument();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(screen.getByText(CHECKOUT_STILL_CONFIRMING_MESSAGE)).toBeInTheDocument();
  });

  it("shows a cancellation notice for billing=canceled", async () => {
    api.getBillingStatus.mockResolvedValue(freeStatus);
    renderBanner("/profile?billing=canceled");
    expect(await screen.findByText(CHECKOUT_CANCELED_MESSAGE)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(CHECKOUT_CANCELED_MESSAGE)).toBeInTheDocument();
    });
  });
});
