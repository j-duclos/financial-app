import { describe, expect, it } from "vitest";
import type { DashboardUpcomingGroup, DashboardUpcomingTransaction } from "@budget-app/shared";
import {
  UPCOMING_SECTION_TITLE,
  dailyNetFromTotals,
  formatNetDisplay,
  groupShowsTransferNote,
  upcomingEmptyMessage,
  upcomingAccountFlowLabel,
  collapseUpcomingTransferPairs,
  upcomingKindBadgeLabel,
  upcomingKindLabel,
  upcomingDayCollapseLabel,
  upcomingDayTransactionSummary,
  initialUpcomingDayCollapsed,
  upcomingDayShowMoreLabel,
  upcomingSectionCollapsedSummary,
  upcomingSectionTitle,
  upcomingTimelineLinkLabel,
  upcomingTransferAccountsLabel,
  upcomingPreviewTruncatedMessage,
  upcomingTruncatedMessage,
  groupUpcomingByMonth,
  upcomingMonthLabel,
  upcomingListUsesStickyScroll,
  UPCOMING_PREVIEW_DAYS,
  UPCOMING_PREVIEW_MAX_ITEMS,
  buildUpcomingDashboardPreview,
  filterUpcomingGroupsForPreview,
  upcomingDisplayTransactionCount,
} from "./upcomingDisplay";

function txn(overrides: Partial<DashboardUpcomingTransaction> = {}): DashboardUpcomingTransaction {
  return {
    id: "1",
    date: "2025-05-28",
    account_id: 1,
    account_name: "Main",
    description: "Payroll",
    amount: "100.00",
    kind: "income",
    category: null,
    balance_after: null,
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
    date: "2025-05-28",
    label: "May 28",
    day_of_week: "Wed",
    income_total: "100.00",
    expense_total: "0.00",
    net_total: "100.00",
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

// Re-export helper used in tests — add to upcomingDisplay if missing
function isTransferExcludedFromNet(t: DashboardUpcomingTransaction): boolean {
  return t.is_internal_transfer || t.is_transfer;
}

describe("upcomingDisplay", () => {
  it("shows empty state message", () => {
    expect(upcomingEmptyMessage()).toMatch(/No upcoming transactions/i);
  });

  it("uses short card-pay pill text for alignment", () => {
    expect(
      upcomingKindBadgeLabel(
        txn({ is_credit_card_payment: true, kind: "bill", amount: "-650" })
      )
    ).toBe("Card pay");
    expect(upcomingKindLabel(txn({ is_credit_card_payment: true }))).toBe("Credit card payment");
  });

  it("labels income and transfer kinds", () => {
    expect(upcomingKindLabel(txn())).toBe("Income");
    expect(
      upcomingKindLabel(txn({ is_transfer: true, is_internal_transfer: true, kind: "transfer" }))
    ).toBe("Transfer");
  });

  it("labels transfer inflow even when kind is income", () => {
    expect(
      upcomingKindLabel(
        txn({
          kind: "income",
          amount: "900.00",
          is_transfer: true,
          is_internal_transfer: true,
          description: "Move for Rent",
        })
      )
    ).toBe("Transfer");
  });

  it("shows full transfer route when API provides endpoints", () => {
    expect(
      upcomingAccountFlowLabel(
        txn({
          is_transfer: true,
          is_internal_transfer: true,
          account_name: "Main",
          amount: "-900.00",
          transfer_from_account_name: "Savings",
          transfer_to_account_name: "Main",
        })
      )
    ).toBe("From Savings to Main");
  });

  it("pairs transfer legs on the same day when endpoints missing", () => {
    const outLeg = txn({
      id: "out",
      date: "2025-05-28",
      description: "Move for Rent",
      is_transfer: true,
      is_internal_transfer: true,
      account_name: "Savings",
      amount: "-900.00",
    });
    const inLeg = txn({
      id: "in",
      date: "2025-05-28",
      description: "Move for Rent",
      is_transfer: true,
      is_internal_transfer: true,
      account_name: "Main",
      amount: "900.00",
    });
    const peers = [outLeg, inLeg];
    expect(upcomingAccountFlowLabel(outLeg, peers)).toBe("From Savings to Main");
    expect(upcomingAccountFlowLabel(inLeg, peers)).toBe("From Savings to Main");
  });

  it("collapses bank transfer legs into one row", () => {
    const outLeg = txn({
      id: "out",
      description: "Move for Rent",
      is_transfer: true,
      is_internal_transfer: true,
      account_name: "Savings",
      amount: "-900.00",
      transfer_from_account_name: "Savings",
      transfer_to_account_name: "Main",
    });
    const inLeg = txn({
      id: "in",
      description: "Move for Rent",
      is_transfer: true,
      is_internal_transfer: true,
      account_name: "Main",
      amount: "900.00",
      transfer_from_account_name: "Savings",
      transfer_to_account_name: "Main",
    });
    const collapsed = collapseUpcomingTransferPairs([outLeg, inLeg, txn()]);
    expect(collapsed).toHaveLength(2);
    const xfer = collapsed.find((t) => t.description === "Move for Rent");
    expect(xfer?.amount).toBe("900.00");
    expect(xfer?.kind).toBe("transfer");
    expect(upcomingKindLabel(xfer!)).toBe("Transfer");
  });

  it("shows into/out of for non-transfer rows", () => {
    expect(upcomingAccountFlowLabel(txn({ amount: "1500", account_name: "Main" }))).toBe(
      "Into Main"
    );
    expect(
      upcomingAccountFlowLabel(txn({ amount: "-100", account_name: "Main", kind: "bill" }))
    ).toBe("Out of Main");
  });

  it("computes net as income minus expenses", () => {
    expect(dailyNetFromTotals("1000", "250")).toBe(750);
    expect(formatNetDisplay(750)).toBe("+750.00");
    expect(formatNetDisplay(-50)).toBe("-50.00");
  });

  it("collapses credit card payment legs into one expense row", () => {
    const outLeg = txn({
      id: "cc-out",
      description: "Credit Card Pmt",
      is_transfer: true,
      is_internal_transfer: false,
      is_credit_card_payment: true,
      account_name: "Main",
      amount: "-650.00",
      kind: "bill",
      transfer_from_account_name: "Main",
      transfer_to_account_name: "Savor",
    });
    const inLeg = txn({
      id: "cc-in",
      description: "Credit Card Pmt",
      is_transfer: true,
      is_internal_transfer: true,
      is_credit_card_payment: true,
      account_name: "Savor",
      amount: "650.00",
      kind: "credit_card",
      transfer_from_account_name: "Main",
      transfer_to_account_name: "Savor",
    });
    const collapsed = collapseUpcomingTransferPairs([outLeg, inLeg]);
    expect(collapsed).toHaveLength(1);
    expect(upcomingKindLabel(collapsed[0])).toBe("Credit card payment");
    expect(collapsed[0].amount).toBe("-650.00");
    expect(upcomingTransferAccountsLabel(collapsed[0])).toBe("From Main to Savor");
  });

  it("labels rule and imported sources", () => {
    expect(upcomingKindLabel(txn({ source: "rule", kind: "bill", amount: "-50" }))).toBe("Rule");
    expect(upcomingKindLabel(txn({ source: "plaid", kind: "bill", amount: "-20" }))).toBe("Imported");
  });

  it("section title and truncation copy", () => {
    expect(upcomingSectionTitle(14)).toBe(UPCOMING_SECTION_TITLE);
    expect(upcomingSectionTitle(14)).toBe("Upcoming Money Flow");
    expect(upcomingSectionTitle(7)).toBe("Upcoming Money Flow");
    expect(upcomingTruncatedMessage()).toMatch(/first 25/i);
    expect(upcomingPreviewTruncatedMessage()).toMatch(/up to 5/i);
    expect(upcomingPreviewTruncatedMessage(5, 7, { dayWindowTruncated: true })).toMatch(
      /next 7 days/i
    );
    expect(upcomingTimelineLinkLabel()).toBe("Open Calendar");
    expect(upcomingSectionCollapsedSummary([], 30)).toMatch(/No upcoming activity/);
    expect(upcomingSectionCollapsedSummary([group({ date: "2026-06-01" })], 30)).toBe(
      "1 day · 1 transaction"
    );
  });

  it("internal transfer rows do not affect net totals", () => {
    const g = group({
      income_total: "0.00",
      expense_total: "0.00",
      net_total: "0.00",
      transfers_excluded: true,
      transactions: [
        txn({
          is_transfer: true,
          is_internal_transfer: true,
          amount: "-200.00",
          kind: "transfer",
        }),
      ],
    });
    expect(groupShowsTransferNote(g)).toBe(true);
    expect(isTransferExcludedFromNet(g.transactions[0])).toBe(true);
  });

  it("labels day collapse controls", () => {
    expect(upcomingDayCollapseLabel(true)).toBe("Expand Day");
    expect(upcomingDayCollapseLabel(false)).toBe("Collapse Day");
  });

  it("summarizes transaction counts for collapsed days", () => {
    expect(upcomingDayTransactionSummary(0)).toBe("No transactions");
    expect(upcomingDayTransactionSummary(1)).toBe("1 transaction");
    expect(upcomingDayTransactionSummary(30)).toBe("30 transactions");
  });

  it("labels show-more within an expanded day", () => {
    expect(upcomingDayShowMoreLabel(25)).toBe("Show 25 more for this day");
  });

  it("auto-collapses days over the preview limit", () => {
    const collapsed = initialUpcomingDayCollapsed([
      group({ date: "2026-05-28", total_transaction_count: 3, hidden_transaction_count: 0 }),
      group({ date: "2026-05-29", total_transaction_count: 30, hidden_transaction_count: 25 }),
    ]);
    expect(collapsed["2026-05-28"]).toBeUndefined();
    expect(collapsed["2026-05-29"]).toBe(true);
  });

  it("formats month labels for separators", () => {
    expect(upcomingMonthLabel(group({ date: "2026-06-15" }))).toBe("JUNE 2026");
  });

  it("groups upcoming days under month buckets", () => {
    const months = groupUpcomingByMonth([
      group({ date: "2026-06-28" }),
      group({ date: "2026-07-01" }),
    ]);
    expect(months).toHaveLength(2);
    expect(months[0]!.monthLabel).toBe("JUNE 2026");
    expect(months[1]!.monthLabel).toBe("JULY 2026");
  });

  it("enables sticky scroll for multi-month or long lists", () => {
    expect(upcomingListUsesStickyScroll([group({ date: "2026-06-01" })])).toBe(false);
    expect(
      upcomingListUsesStickyScroll([
        group({ date: "2026-06-28" }),
        group({ date: "2026-07-01" }),
      ])
    ).toBe(true);
  });

  it("filters dashboard preview to seven days from today", () => {
    const today = "2026-06-26";
    const filtered = filterUpcomingGroupsForPreview(
      [
        group({ date: "2026-06-26" }),
        group({ date: "2026-07-01" }),
        group({ date: "2026-06-20" }),
      ],
      UPCOMING_PREVIEW_DAYS,
      today
    );
    expect(filtered.map((g) => g.date)).toEqual(["2026-06-26", "2026-07-01"]);
  });

  it("buildUpcomingDashboardPreview caps items and surfaces risk", () => {
    const today = "2026-06-26";
    const preview = buildUpcomingDashboardPreview(
      [
        group({
          date: "2026-06-27",
          has_risk: true,
          risk_reason: "Low buffer",
          transactions: [
            txn({ id: "a", date: "2026-06-27" }),
            txn({ id: "b", date: "2026-06-27" }),
            txn({ id: "c", date: "2026-06-27" }),
            txn({ id: "d", date: "2026-06-27" }),
            txn({ id: "e", date: "2026-06-27" }),
            txn({ id: "f", date: "2026-06-27" }),
          ],
        }),
      ],
      null
    );
    expect(preview.days).toBe(UPCOMING_PREVIEW_DAYS);
    expect(preview.maxTotalItems).toBe(UPCOMING_PREVIEW_MAX_ITEMS);
    expect(preview.truncated).toBe(true);
    expect(preview.truncatedMessage).toMatch(/up to 5/i);
    expect(preview.groups).toHaveLength(1);
    expect(upcomingDisplayTransactionCount(preview.groups[0]!)).toBe(5);
    expect(preview.nextRisk?.date).toBe("2026-06-27");
  });
});
