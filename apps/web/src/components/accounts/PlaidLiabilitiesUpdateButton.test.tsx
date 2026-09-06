/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaidLiabilitiesUpdateButton } from "./PlaidLiabilitiesUpdateButton";

const api = vi.hoisted(() => ({
  createPlaidUpdateModeLinkToken: vi.fn(async () => ({
    link_token: "link-update-token",
    update_mode: true,
  })),
  syncPlaidItemLiabilities: vi.fn(async () => ({
    item_id: 12,
    status: "success",
    observed_at: "2026-09-05T20:00:00Z",
    accounts_seen: 1,
    accounts_updated: 1,
    accounts_unchanged: 0,
    accounts_missing_liability: 0,
    warnings: [],
  })),
}));

vi.mock("@budget-app/api-client", () => api);
vi.mock("react-plaid-link", () => ({
  usePlaidLink: () => ({ open: vi.fn(), ready: false }),
}));
vi.mock("../../lib/plaidRedirectUri", () => ({
  getPlaidRedirectUri: () => "https://example.test/plaid/oauth-return",
}));

describe("PlaidLiabilitiesUpdateButton", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    api.createPlaidUpdateModeLinkToken.mockClear();
    api.syncPlaidItemLiabilities.mockClear();
  });

  it("does not launch Plaid Link until the user asks to enable minimum updates", () => {
    render(<PlaidLiabilitiesUpdateButton itemId={12} onComplete={vi.fn()} />);
    expect(api.createPlaidUpdateModeLinkToken).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /enable credit-card minimum updates/i })).toBeEnabled();
  });

  it("requests an update-mode link token for the exact Plaid Item", async () => {
    const user = userEvent.setup();
    render(<PlaidLiabilitiesUpdateButton itemId={12} onComplete={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /enable credit-card minimum updates/i }));
    expect(api.createPlaidUpdateModeLinkToken).toHaveBeenCalledWith(12, {
      redirect_uri: "https://example.test/plaid/oauth-return",
    });
    expect(api.syncPlaidItemLiabilities).not.toHaveBeenCalled();
  });
});
