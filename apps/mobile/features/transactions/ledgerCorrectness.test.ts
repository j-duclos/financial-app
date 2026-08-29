import { describe, expect, it } from "vitest";
import type { Transaction, TimelineRow } from "@budget-app/shared";
import {
  buildTransactionListRows,
  currentBalanceFromLedgerData,
  forecastBalanceFromUpcoming,
  indexTimelineBalances,
  partitionTimelineForLedger,
} from "@/features/transactions/buildTransactionList";
import { DEFAULT_TRANSACTION_FILTERS } from "@/features/transactions/types";
import {
  formatLedgerHeaderBalanceLine,
  resolveAccountCurrentBalance,
  resolveLedgerHeaderBalances,
} from "@/features/transactions/ledgerHeaderDisplay";
import {
  isForecastTimelineRow,
  isPendingExpectedTimelineRow,
} from "@/features/transactions/pendingSemantics";

const txn = (
  partial: Partial<Transaction> & Pick<Transaction, "id" | "payee" | "amount" | "date">
): Transaction =>
  ({
    direction: "OUTFLOW",
    cleared: true,
    reconciled: false,
    memo: "",
    tags: [],
    account: { id: 1, name: "Main" } as Transaction["account"],
    category: null,
    ...partial,
  }) as Transaction;

const timelineRow = (partial: Partial<TimelineRow> & Pick<TimelineRow, "date" | "description" | "amount">): TimelineRow =>
  ({
    account_id: 1,
    account_name: "Main",
    category_id: null,
    category_name: null,
    type: "expense",
    status: "PLANNED",
    source: "rule",
    rule_id: 5,
    transaction_id: null,
    running_balance: "0.00",
    ...partial,
  });

describe("buildTransactionListRows sections", () => {
  it("orders Recent, then Pending, then Upcoming", () => {
    const rows = buildTransactionListRows({
      history: [txn({ id: 10, payee: "Chewy", amount: "-119.14", date: "2026-08-26" })],
      pending: [
        timelineRow({
          date: "2026-08-26",
          description: "Due bill",
          amount: "-50.00",
          running_balance: "100.00",
          status: "PLANNED",
          source: "rule",
        }),
      ],
      upcoming: [
        timelineRow({
          date: "2026-08-27",
          description: "Move to Savings",
          amount: "-497.00",
          running_balance: "-1406.40",
          status: "PLANNED",
          source: "rule",
        }),
      ],
      balanceMap: new Map(),
      filters: { ...DEFAULT_TRANSACTION_FILTERS, accountId: 1 },
      today: "2026-08-26",
    });

    const titles = rows.filter((r) => r.kind === "section").map((r) => (r.kind === "section" ? r.title : ""));
    expect(titles).toEqual(["Recent", "Pending", "Upcoming"]);
    expect(rows.some((r) => r.kind === "history")).toBe(true);
    expect(rows.some((r) => r.kind === "pending")).toBe(true);
    expect(rows.some((r) => r.kind === "upcoming")).toBe(true);
  });

  it("excludes pending planned transactions from Recent", () => {
    const rows = buildTransactionListRows({
      history: [
        txn({
          id: 11,
          payee: "Scheduled",
          amount: "-20.00",
          date: "2026-08-26",
          status: "PLANNED",
          source: "RULE",
          rule_id: 9,
        }),
        txn({ id: 12, payee: "Posted", amount: "-10.00", date: "2026-08-25" }),
      ],
      pending: [],
      upcoming: [],
      balanceMap: new Map(),
      filters: { ...DEFAULT_TRANSACTION_FILTERS, accountId: 1 },
      today: "2026-08-26",
    });
    const history = rows.filter((r) => r.kind === "history");
    expect(history).toHaveLength(1);
    expect(history[0].kind === "history" && history[0].txn.payee).toBe("Posted");
  });

  it("hides reconciled running balances when sealed", () => {
    const balanceMap = indexTimelineBalances([
      {
        date: "2026-06-01",
        description: "Old",
        account_id: 1,
        account_name: "Checking",
        category_id: null,
        category_name: null,
        amount: "-10.00",
        type: "expense",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 10,
        running_balance: "100.00",
        reconciled: true,
        reconciled_balance: "100.00",
      },
    ]);

    const rows = buildTransactionListRows({
      upcoming: [],
      pending: [],
      history: [txn({ id: 10, payee: "Old", amount: "-10.00", date: "2026-06-01", reconciled: true })],
      balanceMap,
      filters: { ...DEFAULT_TRANSACTION_FILTERS, showReconciled: true },
      today: "2026-06-05",
    });

    const historyRow = rows.find((r) => r.kind === "history");
    expect(historyRow && historyRow.kind === "history" ? historyRow.runningBalance : null).toBeNull();
  });
});

describe("pending vs forecast partition", () => {
  it("classifies due planned as pending and future as upcoming", () => {
    const today = "2026-08-26";
    const pendingRow = timelineRow({
      date: "2026-08-26",
      description: "Due",
      amount: "-10",
      status: "PLANNED",
      source: "rule",
    });
    const upcomingRow = timelineRow({
      date: "2026-08-27",
      description: "Move to Savings",
      amount: "-497.00",
      running_balance: "-1406.40",
      status: "PLANNED",
      source: "rule",
    });
    expect(isPendingExpectedTimelineRow(pendingRow, today)).toBe(true);
    expect(isForecastTimelineRow(upcomingRow, today)).toBe(true);

    const { pending, upcoming } = partitionTimelineForLedger(
      [pendingRow, upcomingRow],
      today,
      1
    );
    expect(pending).toHaveLength(1);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].running_balance).toBe("-1406.40");
  });
});

describe("current balance must not use future balance_after", () => {
  /**
   * Main fixture:
   * current posted balance = 90.60 (example)
   * future Move to Savings = -497
   * future balance after = -1406.40
   */
  const currentPosted = "90.60";
  const futureBalanceAfter = "-1406.40";

  it("resolveAccountCurrentBalance uses available_balance, not projected fields", () => {
    const current = resolveAccountCurrentBalance({
      account_type: "CHECKING",
      available_balance: currentPosted,
      balance: currentPosted,
      projected_balance_30_days: futureBalanceAfter,
      lowest_projected_balance_30_days: futureBalanceAfter,
    });
    expect(current).toBe(currentPosted);
    expect(current).not.toBe(futureBalanceAfter);
  });

  it("header Current stays posted while Forecast may show future balance_after", () => {
    const balances = resolveLedgerHeaderBalances({
      account: {
        account_type: "CHECKING",
        available_balance: currentPosted,
        projected_balance_30_days: futureBalanceAfter,
      },
      forecastBalance: futureBalanceAfter,
    });
    expect(balances.current).toBe(currentPosted);
    expect(balances.forecast).toBe(futureBalanceAfter);

    const line = formatLedgerHeaderBalanceLine(balances, "USD", 30);
    expect(line).toContain("Current");
    expect(line).toContain("30-day forecast");
    expect(line).toMatch(/Current \$90\.60/);
    expect(line).toMatch(/30-day forecast -\$1,406\.40/);
  });

  it("never treats first upcoming running_balance as Current", () => {
    const upcoming = [
      timelineRow({
        date: "2026-08-27",
        description: "Move to Savings",
        amount: "-497.00",
        running_balance: futureBalanceAfter,
      }),
    ];
    const forecast = forecastBalanceFromUpcoming(upcoming);
    expect(forecast).toBe(futureBalanceAfter);

    const balances = resolveLedgerHeaderBalances({
      account: {
        account_type: "CHECKING",
        available_balance: currentPosted,
      },
      forecastBalance: forecast,
    });
    expect(balances.current).toBe(currentPosted);
    expect(balances.current).not.toBe(balances.forecast);
  });

  it("upcoming row may correctly show Bal -$1,406.40", () => {
    const rows = buildTransactionListRows({
      history: [],
      pending: [],
      upcoming: [
        timelineRow({
          date: "2026-08-27",
          description: "Move to Savings",
          amount: "-497.00",
          running_balance: futureBalanceAfter,
        }),
      ],
      balanceMap: new Map(),
      filters: { ...DEFAULT_TRANSACTION_FILTERS, accountId: 1 },
      today: "2026-08-26",
    });
    const upcoming = rows.find((r) => r.kind === "upcoming");
    expect(upcoming && upcoming.kind === "upcoming" ? upcoming.runningBalance : null).toBe(
      futureBalanceAfter
    );
  });
});

describe("header balances independent of presentation filters", () => {
  const today = "2026-08-26";
  const pendingBalance = "112.26";
  const forecastEnding = "85.50";

  const history = [
    txn({
      id: 20,
      payee: "Groceries",
      amount: "-40.00",
      date: "2026-08-25",
      running_balance: "90.00",
      category_id: 1,
      category: { id: 1, name: "Food" } as Transaction["category"],
    }),
    txn({
      id: 21,
      payee: "Paycheck",
      amount: "2000.00",
      date: "2026-08-24",
      running_balance: "130.00",
      direction: "INFLOW",
      category_id: 2,
      category: { id: 2, name: "Income" } as Transaction["category"],
    }),
  ];

  const pending = [
    timelineRow({
      date: today,
      description: "Due bill",
      amount: "-10.00",
      balance_after: pendingBalance,
      status: "PLANNED",
      source: "rule",
      transaction_id: 30,
    }),
  ];

  const upcoming = [
    timelineRow({
      date: "2026-08-27",
      description: "Scheduled transfer",
      amount: "-26.76",
      balance_after: forecastEnding,
      status: "PLANNED",
      source: "rule",
    }),
  ];

  function activityRowCount(filters: typeof DEFAULT_TRANSACTION_FILTERS) {
    const rows = buildTransactionListRows({
      history,
      pending,
      upcoming,
      balanceMap: new Map(),
      filters,
      today,
    });
    return rows.filter(
      (r) => r.kind === "history" || r.kind === "pending" || r.kind === "upcoming"
    ).length;
  }

  function headerBalances(filters: typeof DEFAULT_TRANSACTION_FILTERS) {
    return {
      current: currentBalanceFromLedgerData({
        pending,
        history,
        today,
        showReconciled: filters.showReconciled,
      }),
      forecast: forecastBalanceFromUpcoming(upcoming),
      activityRows: activityRowCount(filters),
    };
  }

  const base = { ...DEFAULT_TRANSACTION_FILTERS, accountId: 1 };

  it("category filter changes rows but not Current or Forecast header balances", () => {
    const unfiltered = headerBalances(base);
    const filtered = headerBalances({ ...base, categoryId: 1 });
    expect(filtered.activityRows).toBeLessThan(unfiltered.activityRows);
    expect(filtered.current).toBe(unfiltered.current);
    expect(filtered.forecast).toBe(unfiltered.forecast);
  });

  it("amount filter changes rows but not header balances", () => {
    const unfiltered = headerBalances(base);
    const filtered = headerBalances({ ...base, amountMin: 100 });
    expect(filtered.activityRows).toBeLessThan(unfiltered.activityRows);
    expect(filtered.current).toBe(unfiltered.current);
    expect(filtered.forecast).toBe(unfiltered.forecast);
  });

  it("flow filter changes rows but not header balances", () => {
    const unfiltered = headerBalances(base);
    const filtered = headerBalances({ ...base, flow: "income" });
    expect(filtered.activityRows).toBeLessThan(unfiltered.activityRows);
    expect(filtered.current).toBe(unfiltered.current);
    expect(filtered.forecast).toBe(unfiltered.forecast);
  });

  it("search filter changes rows but not header balances", () => {
    const unfiltered = headerBalances(base);
    const filtered = headerBalances({ ...base, search: "Groceries" });
    expect(filtered.activityRows).toBeLessThan(unfiltered.activityRows);
    expect(filtered.current).toBe(unfiltered.current);
    expect(filtered.forecast).toBe(unfiltered.forecast);
  });

  it("Current uses pending ending balance, not last filtered visible row", () => {
    expect(headerBalances({ ...base, flow: "income" }).current).toBe(pendingBalance);
    expect(headerBalances({ ...base, search: "missing" }).current).toBe(pendingBalance);
  });

  it("Forecast uses last unfiltered upcoming balance_after", () => {
    expect(headerBalances({ ...base, amountMax: 1 }).forecast).toBe(forecastEnding);
    expect(headerBalances({ ...base, flow: "expense" }).forecast).toBe(forecastEnding);
  });
});
