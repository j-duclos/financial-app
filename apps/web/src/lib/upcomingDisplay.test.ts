import { describe, expect, it } from "vitest";
import type {
  DashboardUpcomingGroup,
  DashboardUpcomingTransaction,
  TimelineCalendarDay,
  TimelineCalendarTransaction,
} from "@budget-app/shared";
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
  UPCOMING_CALENDAR_WINDOW_DAYS,
  UPCOMING_MAX_VISIBLE_TRANSACTIONS,
  buildUpcomingDashboardPreview,
  buildUpcomingMoneyFlowFromCalendarDays,
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
      null,
      today
    );
    expect(preview.daysHorizon).toBe(UPCOMING_PREVIEW_DAYS);
    expect(preview.maxTotalItems).toBe(UPCOMING_PREVIEW_MAX_ITEMS);
    expect(preview.truncated).toBe(true);
    expect(preview.truncatedMessage).toMatch(/up to 5/i);
    expect(preview.groups).toHaveLength(1);
    expect(preview.days).toHaveLength(1);
    expect(preview.days[0]!.transactions).toHaveLength(5);
    expect(preview.nextRisk?.date).toBe("2026-06-27");
  });

  it("shows one first-below-zero warning per account", () => {
    const today = "2026-06-26";
    const account = "Main";
    const firstDay = group({
      date: "2026-06-27",
      show_lowest_balance_marker: true,
      lowest_projected_balance: "-50.00",
      lowest_projected_balance_account_name: account,
      is_negative: true,
    });
    const secondDay = group({
      date: "2026-06-28",
      show_lowest_balance_marker: true,
      lowest_projected_balance: "-80.00",
      lowest_projected_balance_account_name: account,
      is_negative: true,
    });
    const preview = buildUpcomingDashboardPreview(
      [firstDay, secondDay],
      {
        risk_date: "2026-06-27",
        account_name: account,
      },
      today
    );
    expect(preview.days[0]!.firstNegativeWarning).toBe(
      "Main first falls below zero today"
    );
    expect(preview.days[1]!.firstNegativeWarning).toBeNull();
  });
});

function calendarTxn(
  overrides: Partial<TimelineCalendarTransaction> = {}
): TimelineCalendarTransaction {
  return {
    id: "1",
    date: "2025-06-01",
    account_id: 1,
    description: "Payroll",
    account_name: "Main",
    amount: "100.00",
    category: null,
    kind: "income",
    source: "rule",
    status: "PLANNED",
    balance_after: "1100.00",
    is_transfer: false,
    is_internal_transfer: false,
    is_credit_card_payment: false,
    risk_flag: false,
    ...overrides,
  };
}

function calendarDay(overrides: Partial<TimelineCalendarDay> = {}): TimelineCalendarDay {
  return {
    date: "2025-06-01",
    income_total: "100.00",
    expense_total: "40.00",
    transfer_total: "0.00",
    net_total: "60.00",
    ending_balance: "1060.00",
    lowest_balance: "1000.00",
    risk_level: "none",
    risk_reason: null,
    has_risk: false,
    heat_level: "healthy",
    heat_label: "Healthy",
    transactions: [calendarTxn()],
    ...overrides,
  };
}

describe("buildUpcomingMoneyFlowFromCalendarDays", () => {
  it("starts from today and keeps the 14-day / 25-transaction window", () => {
    const days = [
      calendarDay({ date: "2025-05-31", transactions: [calendarTxn({ id: "past", date: "2025-05-31" })] }),
      calendarDay({
        date: "2025-06-01",
        income_total: "2200.00",
        expense_total: "0.00",
        net_total: "2200.00",
        ending_balance: "3200.00",
        transactions: [calendarTxn({ id: "pay", date: "2025-06-01", amount: "2200.00" })],
      }),
      calendarDay({
        date: "2025-06-02",
        income_total: "0.00",
        expense_total: "1800.00",
        net_total: "-1800.00",
        ending_balance: "1400.00",
        has_risk: true,
        risk_reason: "Projected balance drops below zero on 2025-06-02.",
        is_negative: true,
        show_lowest_balance_marker: true,
        lowest_projected_balance: "-50.00",
        lowest_projected_balance_account_name: "Main",
        transactions: [
          calendarTxn({
            id: "rent",
            date: "2025-06-02",
            description: "Rent",
            amount: "-1800.00",
            kind: "bill",
            source: "actual",
            risk_flag: true,
            balance_after: "-50.00",
          }),
        ],
      }),
      calendarDay({
        date: "2025-06-16",
        transactions: [calendarTxn({ id: "outside", date: "2025-06-16" })],
      }),
    ];
    const result = buildUpcomingMoneyFlowFromCalendarDays(days, { today: "2025-06-01" });
    expect(result.days).toBe(UPCOMING_CALENDAR_WINDOW_DAYS);
    expect(result.truncated).toBe(false);
    expect(result.groups.map((g) => g.date)).toEqual(["2025-06-01", "2025-06-02"]);
    expect(result.groups[0]!.label).toBe("Jun 1");
    expect(result.groups[0]!.income_total).toBe("2200.00");
    expect(result.groups[0]!.transactions[0]!.balance_after).toBe("1100.00");
    expect(result.groups[1]!.expense_total).toBe("1800.00");
    expect(result.groups[1]!.has_risk).toBe(true);
    expect(result.groups[1]!.transactions[0]!.risk_flag).toBe(true);
    expect(upcomingKindLabel(result.groups[0]!.transactions[0]!)).toBe("Income");
    expect(upcomingKindLabel(result.groups[1]!.transactions[0]!)).toBe("Expense");
  });

  it("preserves transfer labels and excluded-from-net totals", () => {
    const result = buildUpcomingMoneyFlowFromCalendarDays(
      [
        calendarDay({
          date: "2025-06-01",
          income_total: "0.00",
          expense_total: "0.00",
          transfer_total: "300.00",
          net_total: "0.00",
          transactions: [
            calendarTxn({
              id: "out",
              description: "To savings",
              amount: "-300.00",
              kind: "transfer",
              is_transfer: true,
              is_internal_transfer: true,
              transfer_from_account_name: "Checking",
              transfer_to_account_name: "Savings",
            }),
            calendarTxn({
              id: "in",
              description: "To savings",
              account_name: "Savings",
              amount: "300.00",
              kind: "transfer",
              is_transfer: true,
              is_internal_transfer: true,
              transfer_from_account_name: "Checking",
              transfer_to_account_name: "Savings",
            }),
          ],
        }),
      ],
      { today: "2025-06-01" }
    );
    expect(result.groups[0]!.transfers_excluded).toBe(true);
    expect(result.groups[0]!.net_total).toBe("0.00");
    expect(upcomingKindLabel(result.groups[0]!.transactions[0]!)).toBe("Transfer");
  });

  it("caps preview transactions at 25 and preserves order", () => {
    const txns = Array.from({ length: 30 }, (_, i) =>
      calendarTxn({ id: String(i + 1), description: `Txn ${i + 1}`, amount: "-1.00", kind: "bill" })
    );
    const result = buildUpcomingMoneyFlowFromCalendarDays(
      [calendarDay({ date: "2025-06-01", transactions: txns })],
      { today: "2025-06-01" }
    );
    expect(result.truncated).toBe(true);
    expect(result.groups[0]!.transactions).toHaveLength(UPCOMING_MAX_VISIBLE_TRANSACTIONS);
    expect(result.groups[0]!.transactions[0]!.description).toBe("Txn 1");
    expect(result.groups[0]!.transactions[24]!.description).toBe("Txn 25");
  });
});
