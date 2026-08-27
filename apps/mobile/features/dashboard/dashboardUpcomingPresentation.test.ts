import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DashboardUpcomingGroup, DashboardUpcomingTransaction } from "@budget-app/shared";
import { buildUpcomingDashboardPreview, upcomingTransactionNavTarget } from "@budget-app/shared";

const upcomingSectionSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardDetailsSections.tsx"),
  "utf8"
);
const upcomingRowSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardUpcomingRow.tsx"),
  "utf8"
);

function txn(overrides: Partial<DashboardUpcomingTransaction> = {}): DashboardUpcomingTransaction {
  return {
    id: "42",
    date: "2026-08-28",
    account_id: 1,
    account_name: "Main",
    description: "2930 JOHN GALT S PAYROLL PPD ID: 14409866",
    amount: "-79.46",
    kind: "bill",
    category: null,
    balance_after: "-750.34",
    is_transfer: false,
    is_internal_transfer: false,
    is_credit_card_payment: false,
    source: "rule",
    status: "PLANNED",
    risk_flag: false,
    ...overrides,
  };
}

function group(overrides: Partial<DashboardUpcomingGroup> = {}): DashboardUpcomingGroup {
  return {
    date: "2026-08-28",
    label: "Aug 28",
    day_of_week: "Fri",
    income_total: "0.00",
    expense_total: "79.46",
    net_total: "-79.46",
    transfer_total: "0.00",
    transfers_excluded: false,
    has_risk: false,
    risk_reason: null,
    transactions: [txn()],
    hidden_transaction_count: 0,
    total_transaction_count: 1,
    ...overrides,
  };
}

describe("Dashboard upcoming presentation", () => {
  it("uses one grouped container instead of per-transaction cards", () => {
    expect(upcomingSectionSource).toMatch(/DashboardUpcomingRow/);
    expect(upcomingSectionSource).toMatch(/Card style=\{\{ padding: 0/);
    expect(upcomingSectionSource).not.toMatch(/preview\.transactions\.map[\s\S]*?<Card key=\{txn\.id\} onPress/);
  });

  it("keeps first cash shortfall as a separate warning card", () => {
    expect(upcomingSectionSource).toMatch(/First cash shortfall/);
    expect(upcomingSectionSource).toMatch(/warningBg/);
  });

  it("does not change buildUpcomingDashboardPreview selection logic", () => {
    expect(upcomingSectionSource).toMatch(/buildUpcomingDashboardPreview\(upcomingGroups/);
    const groups = Array.from({ length: 6 }, (_, i) =>
      group({
        date: `2026-08-${28 + i}`,
        transactions: [txn({ id: String(i + 1), date: `2026-08-${28 + i}` })],
      })
    );
    const preview = buildUpcomingDashboardPreview(groups, undefined, "2026-08-26");
    expect(preview.transactions).toHaveLength(5);
  });

  it("truncates long descriptions to one line in the row UI", () => {
    expect(upcomingRowSource).toMatch(/numberOfLines=\{1\}/);
    expect(upcomingRowSource).toMatch(/ellipsizeMode="tail"/);
    expect(txn().description).toContain("JOHN GALT");
  });

  it("shows amount on the primary row and account with balance on secondary metadata", () => {
    expect(upcomingRowSource).toMatch(/Balance after/);
    expect(upcomingRowSource).toMatch(/metaParts\.join\(" · "\)/);
    expect(upcomingRowSource).toMatch(/account_name/);
    expect(upcomingRowSource).toMatch(/flexShrink: 0/);
  });

  it("uses row dividers inside the grouped container", () => {
    expect(upcomingRowSource).toMatch(/showDivider/);
    expect(upcomingRowSource).toMatch(/backgroundColor: theme\.colors\.border/);
  });

  it("retains navigation to transaction detail or calendar date", () => {
    expect(upcomingSectionSource).toMatch(/upcomingTransactionNavTarget/);
    expect(upcomingTransactionNavTarget(txn({ id: "99" }))).toEqual({
      type: "transaction",
      transactionId: 99,
    });
    expect(upcomingTransactionNavTarget(txn({ id: "xfer-1-2" }))).toEqual({
      type: "calendar",
      date: "2026-08-28",
    });
  });

  it("provides combined accessibility labels per row", () => {
    expect(upcomingRowSource).toMatch(/upcomingRowAccessibilityLabel/);
    expect(upcomingRowSource).toMatch(/accessibilityLabel=\{upcomingRowAccessibilityLabel/);
  });
});
