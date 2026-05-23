import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  computeGroupSummary,
  filterAccounts,
  groupAccounts,
  reorderAccountsInGroup,
  sortAccounts,
  DEFAULT_ACCOUNT_ORG_PREFERENCES,
} from "./accountOrganization";

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

describe("filterAccounts", () => {
  const accounts = [
    mockAccount({ id: 1, health_status: "risk", role: "spending" }),
    mockAccount({ id: 2, health_status: "healthy", status: "archived", archived: true }),
    mockAccount({ id: 3, account_type: "CREDIT", role: "credit_card", health_status: "watch" }),
  ];

  it("shows only active accounts by default", () => {
    const filtered = filterAccounts(accounts, {
      ...DEFAULT_ACCOUNT_ORG_PREFERENCES.filters,
      hideArchived: true,
    });
    expect(filtered.map((a) => a.id)).toEqual([1, 3]);
  });

  it("shows archived when showArchived is enabled", () => {
    const filtered = filterAccounts(accounts, {
      ...DEFAULT_ACCOUNT_ORG_PREFERENCES.filters,
      hideArchived: false,
      showArchived: true,
    });
    expect(filtered.map((a) => a.id)).toContain(2);
  });

  it("filters risk-only accounts", () => {
    const filtered = filterAccounts(accounts, {
      ...DEFAULT_ACCOUNT_ORG_PREFERENCES.filters,
      riskOnly: true,
    });
    expect(filtered.map((a) => a.id)).toEqual([1]);
  });

  it("filters debt accounts", () => {
    const filtered = filterAccounts(accounts, {
      ...DEFAULT_ACCOUNT_ORG_PREFERENCES.filters,
      debtOnly: true,
    });
    expect(filtered.map((a) => a.id)).toEqual([3]);
  });
});

describe("sortAccounts", () => {
  it("sorts by health severity then name", () => {
    const accounts = [
      mockAccount({ id: 1, display_name: "Zebra", health_status: "healthy" }),
      mockAccount({ id: 2, display_name: "Alpha", health_status: "critical" }),
      mockAccount({ id: 3, display_name: "Beta", health_status: "risk" }),
    ];
    const sorted = sortAccounts(accounts, "health_worst_first");
    expect(sorted.map((a) => a.id)).toEqual([2, 3, 1]);
  });

  it("sorts by custom position", () => {
    const accounts = [
      mockAccount({ id: 1, position: 2 }),
      mockAccount({ id: 2, position: 0 }),
      mockAccount({ id: 3, position: 1 }),
    ];
    const sorted = sortAccounts(accounts, "custom");
    expect(sorted.map((a) => a.id)).toEqual([2, 3, 1]);
  });
});

describe("groupAccounts", () => {
  it("groups by role with default sort", () => {
    const accounts = [
      mockAccount({ id: 1, role: "credit_card", account_type: "CREDIT" }),
      mockAccount({ id: 2, role: "spending" }),
      mockAccount({ id: 3, role: "savings", account_type: "SAVINGS" }),
    ];
    const groups = groupAccounts(accounts, "role", "name_asc");
    expect(groups.map((g) => g.key)).toEqual(["spending", "savings", "credit_card"]);
    expect(groups[0].accounts.map((a) => a.id)).toEqual([2]);
  });

  it("returns flat list for none grouping", () => {
    const accounts = [mockAccount({ id: 1 }), mockAccount({ id: 2 })];
    const groups = groupAccounts(accounts, "none", "name_asc");
    expect(groups).toHaveLength(1);
    expect(groups[0].accounts).toHaveLength(2);
  });
});

describe("computeGroupSummary", () => {
  it("aggregates credit debt and utilization", () => {
    const accounts = [
      mockAccount({
        id: 1,
        account_type: "CREDIT",
        role: "credit_card",
        balance_owed: "500",
        utilization_percent: "40",
      }),
      mockAccount({
        id: 2,
        account_type: "CREDIT",
        role: "credit_card",
        balance_owed: "300",
        utilization_percent: "60",
      }),
    ];
    const summary = computeGroupSummary(accounts);
    expect(summary.count).toBe(2);
    expect(summary.totalDebt).toBe(800);
    expect(summary.avgUtilization).toBe(50);
  });

  it("counts at-risk accounts", () => {
    const accounts = [
      mockAccount({ id: 1, health_status: "risk" }),
      mockAccount({ id: 2, health_status: "healthy" }),
    ];
    expect(computeGroupSummary(accounts).riskCount).toBe(1);
  });
});

describe("reorderAccountsInGroup", () => {
  it("reorders within group while preserving global order of others", () => {
    const accounts = [
      mockAccount({ id: 10, position: 0 }),
      mockAccount({ id: 20, position: 1 }),
      mockAccount({ id: 30, position: 2 }),
      mockAccount({ id: 40, position: 3 }),
    ];
    const order = reorderAccountsInGroup(accounts, [20, 30], 0, 1);
    expect(order).toEqual([10, 30, 20, 40]);
  });
});

describe("load/save preferences", () => {
  it("defaults groupBy to role", () => {
    expect(DEFAULT_ACCOUNT_ORG_PREFERENCES.groupBy).toBe("role");
    expect(DEFAULT_ACCOUNT_ORG_PREFERENCES.sortBy).toBe("health_worst_first");
  });
});
