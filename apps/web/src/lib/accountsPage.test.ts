import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  computeAccountsPageStats,
  formatAccountsPageSummaryLine,
  accountsPageShowsGlobalTotals,
} from "./accountPageSummary";
import { formatGroupSummaryParts } from "./accountGroupSummaryDisplay";
import { computeGroupSummary, filterAccounts, accountsForPageStats, DEFAULT_ACCOUNT_ORG_PREFERENCES } from "./accountOrganization";
import { buildAccountManagementActions } from "./accountQuickActions";

function mockAccount(overrides: Partial<Account> & { id: number }): Account {
  const { id, ...rest } = overrides;
  return {
    id,
    household: { id: 1, name: "Home", created_at: "", updated_at: "" },
    account_type: "CHECKING",
    role: "spending",
    name: `Account ${id}`,
    institution: "Chase",
    currency: "USD",
    is_active: true,
    include_in_forecast: true,
    position: id,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-06-01T00:00:00Z",
    balance: "1000",
    available_balance: "1000",
    health_status: "healthy",
    ...rest,
  } as Account;
}

describe("accountPageSummary", () => {
  it("does not expose global dashboard totals on Accounts", () => {
    expect(accountsPageShowsGlobalTotals()).toBe(false);
  });

  it("formats compact summary line", () => {
    const stats = computeAccountsPageStats(
      [
        mockAccount({ id: 1, health_status: "critical" }),
        mockAccount({ id: 2 }),
      ],
      2,
      7
    );
    expect(formatAccountsPageSummaryLine(stats)).toBe(
      "2 accounts • 2 bank logins • 2 active • 1 critical"
    );
  });

  it("excludes deleted and archived from page stats by default", () => {
    const all = [
      mockAccount({ id: 1 }),
      mockAccount({ id: 2 }),
      mockAccount({ id: 3, status: "archived", archived: true }),
      mockAccount({ id: 4, status: "deleted", deleted_at: "2026-01-01T00:00:00Z" }),
    ];
    const countable = accountsForPageStats(all, DEFAULT_ACCOUNT_ORG_PREFERENCES.filters);
    const stats = computeAccountsPageStats(countable, 2, 7);
    expect(stats.totalCount).toBe(2);
    expect(stats.activeCount).toBe(2);
  });
});

describe("accountGroupSummaryDisplay", () => {
  it("shows spending group total and risk count", () => {
    const accounts = [
      mockAccount({ id: 1, role: "spending", available_balance: "69.88", health_status: "risk" }),
    ];
    const summary = computeGroupSummary(accounts);
    const parts = formatGroupSummaryParts("spending", "role", summary);
    expect(parts.some((p) => p.startsWith("Total:"))).toBe(true);
    expect(parts.some((p) => p.includes("at risk"))).toBe(true);
  });

  it("shows savings available after buffer and lowest projected", () => {
    const accounts = [
      mockAccount({
        id: 1,
        role: "savings",
        account_type: "SAVINGS",
        available_to_spend: "3505.93",
        lowest_projected_balance_30_days: "9.36",
      }),
      mockAccount({
        id: 2,
        role: "savings",
        account_type: "SAVINGS",
        available_to_spend: "0",
        lowest_projected_balance_30_days: "9.36",
      }),
    ];
    const summary = computeGroupSummary(accounts);
    const parts = formatGroupSummaryParts("savings", "role", summary);
    expect(parts.some((p) => p.startsWith("Available After Buffer:"))).toBe(true);
    expect(parts.some((p) => p.startsWith("Lowest projected:"))).toBe(true);
  });

  it("shows credit balance owed and average utilization", () => {
    const accounts = [
      mockAccount({
        id: 1,
        role: "credit_card",
        account_type: "CREDIT",
        balance_owed: "500",
        utilization_percent: "40",
      }),
      mockAccount({
        id: 2,
        role: "credit_card",
        account_type: "CREDIT",
        balance_owed: "300",
        utilization_percent: "60",
      }),
    ];
    const summary = computeGroupSummary(accounts);
    const parts = formatGroupSummaryParts("credit_card", "role", summary);
    expect(parts).toContain("Balance owed: $800.00");
    expect(parts).toContain("Average utilization: 50%");
  });
});

describe("accounts page filters", () => {
  const accounts = [
    mockAccount({ id: 1 }),
    mockAccount({ id: 2, include_in_forecast: false }),
    mockAccount({ id: 3, status: "archived", archived: true }),
  ];
  const plaidIds = new Set([1]);

  it("filters plaid-linked accounts", () => {
    const filtered = filterAccounts(
      accounts,
      { ...DEFAULT_ACCOUNT_ORG_PREFERENCES.filters, plaidSource: "plaid" },
      { plaidLinkedAccountIds: plaidIds }
    );
    expect(filtered.map((a) => a.id)).toEqual([1]);
  });

  it("filters manual accounts", () => {
    const filtered = filterAccounts(
      accounts,
      { ...DEFAULT_ACCOUNT_ORG_PREFERENCES.filters, plaidSource: "manual" },
      { plaidLinkedAccountIds: plaidIds }
    );
    expect(filtered.map((a) => a.id)).toEqual([2]);
  });

  it("filters excluded-from-forecast accounts", () => {
    const filtered = filterAccounts(accounts, {
      ...DEFAULT_ACCOUNT_ORG_PREFERENCES.filters,
      forecastInclusion: "excluded",
    });
    expect(filtered.map((a) => a.id)).toEqual([2]);
  });
});

describe("account management actions", () => {
  it("keeps destructive actions in danger section only", () => {
    const { secondary, danger } = buildAccountManagementActions({
      isDefault: false,
      lifecycle: "active",
    });
    expect(
      secondary.some(
        (a) => a.id === "mgmt_delete" || a.id === "mgmt_clear_ledger" || a.id === "mgmt_close"
      )
    ).toBe(false);
    expect(danger.map((a) => a.id)).toEqual(["mgmt_close", "mgmt_delete"]);
  });
});
