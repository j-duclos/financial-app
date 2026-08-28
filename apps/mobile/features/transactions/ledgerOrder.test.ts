import { describe, expect, it } from "vitest";
import type { Transaction, TimelineRow } from "@budget-app/shared";
import {
  buildTransactionListRows,
  partitionTimelineForLedger,
  timelineRowLedgerBalance,
} from "@/features/transactions/buildTransactionList";
import {
  DEFAULT_TRANSACTION_FILTERS,
  TRANSACTIONS_LEDGER_ORDERING,
} from "@/features/transactions/types";
import { DEFAULT_TIME_FILTER, pastTransactionsRange } from "@/lib/transactionsLedger";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const timelineRow = (
  partial: Partial<TimelineRow> & Pick<TimelineRow, "date" | "description" | "amount">
): TimelineRow =>
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

describe("Recent historical defaults", () => {
  it("defaults Recent to 14 days", () => {
    expect(DEFAULT_TIME_FILTER).toBe("14d");
    expect(DEFAULT_TRANSACTION_FILTERS.timeFilter).toBe("14d");
    const range = pastTransactionsRange("14d");
    expect(range.end >= range.start).toBe(true);
  });

  it("requests ascending ledger ordering", () => {
    expect(TRANSACTIONS_LEDGER_ORDERING).toBe("date,id");
  });
});

describe("Recent chronological order", () => {
  it("preserves API ascending order and uses canonical running_balance", () => {
    const history = [
      txn({ id: 1, payee: "Old", amount: "-10", date: "2026-08-13", running_balance: "100.00" }),
      txn({ id: 2, payee: "Mid", amount: "-20", date: "2026-08-20", running_balance: "80.00" }),
      txn({
        id: 3,
        payee: "Water Bill",
        amount: "-180",
        date: "2026-08-26",
        running_balance: "484.04",
        cleared: false,
      }),
      txn({
        id: 4,
        payee: "Electric Bill",
        amount: "-405",
        date: "2026-08-26",
        running_balance: "79.04",
      }),
    ];

    const rows = buildTransactionListRows({
      history,
      pending: [],
      upcoming: [],
      balanceMap: new Map(),
      filters: { ...DEFAULT_TRANSACTION_FILTERS, accountId: 1 },
      today: "2026-08-26",
      recentRangeLabel: "Last 14 days",
    });

    const historyRows = rows.filter((r) => r.kind === "history");
    expect(historyRows.map((r) => (r.kind === "history" ? r.txn.payee : ""))).toEqual([
      "Old",
      "Mid",
      "Water Bill",
      "Electric Bill",
    ]);
    expect(historyRows.map((r) => (r.kind === "history" ? r.runningBalance : null))).toEqual([
      "100.00",
      "80.00",
      "484.04",
      "79.04",
    ]);
    expect(rows.some((r) => r.kind === "pending")).toBe(false);
  });

  it("does not put pending-expected transactions in Recent", () => {
    const rows = buildTransactionListRows({
      history: [
        txn({
          id: 9,
          payee: "Scheduled Due",
          amount: "-50",
          date: "2026-08-26",
          status: "PLANNED",
          source: "RULE",
          rule_id: 3,
        }),
        txn({ id: 10, payee: "Posted", amount: "-10", date: "2026-08-25" }),
      ],
      pending: [
        timelineRow({
          date: "2026-08-26",
          description: "Scheduled Due",
          amount: "-50",
          status: "PLANNED",
          source: "rule",
          rule_id: 3,
          running_balance: "40.00",
          balance_after: "31.15",
        }),
      ],
      upcoming: [],
      balanceMap: new Map(),
      filters: { ...DEFAULT_TRANSACTION_FILTERS, accountId: 1 },
      today: "2026-08-26",
    });

    const recentPayees = rows
      .filter((r) => r.kind === "history")
      .map((r) => (r.kind === "history" ? r.txn.payee : ""));
    expect(recentPayees).toEqual(["Posted"]);
    expect(rows.some((r) => r.kind === "pending")).toBe(true);
  });
});

describe("Pending and Upcoming ascending order", () => {
  it("orders pending and upcoming oldest/soonest first", () => {
    const { pending, upcoming } = partitionTimelineForLedger(
      [
        timelineRow({
          date: "2026-08-28",
          description: "Later",
          amount: "-1",
          transaction_id: 2,
          running_balance: "10",
        }),
        timelineRow({
          date: "2026-08-27",
          description: "Move to Savings",
          amount: "-497",
          transaction_id: 1,
          running_balance: "-1406.40",
        }),
        timelineRow({
          date: "2026-08-24",
          description: "Due earlier",
          amount: "-5",
          status: "PLANNED",
          source: "rule",
          running_balance: "50",
        }),
        timelineRow({
          date: "2026-08-26",
          description: "Due later",
          amount: "-5",
          status: "PLANNED",
          source: "rule",
          running_balance: "40",
        }),
      ],
      "2026-08-26",
      1
    );

    expect(pending.map((r) => r.description)).toEqual(["Due earlier", "Due later"]);
    expect(upcoming.map((r) => r.description)).toEqual(["Move to Savings", "Later"]);
    expect(upcoming[0].running_balance).toBe("-1406.40");
  });
});

describe("backend-owned Pending/Upcoming Bal", () => {
  it("renders balance_after from the API and ignores chronological running_balance", () => {
    const history = [
      txn({
        id: 1,
        payee: "AfterPay",
        amount: "-70.99",
        date: "2026-08-25",
        running_balance: "300.29",
      }),
      txn({
        id: 2,
        payee: "Chewy",
        amount: "-119.14",
        date: "2026-08-26",
        running_balance: "81.15",
      }),
    ];

    const pending = [
      timelineRow({
        date: "2026-08-21",
        description: "Chewy",
        amount: "-79.46",
        running_balance: "703.72", // chronological — must not display
        balance_after: "1.69",
        status: "PLANNED",
        source: "rule",
        type: "expense",
      }),
      timelineRow({
        date: "2026-08-24",
        description: "Geico",
        amount: "-403.43",
        running_balance: "300.29",
        balance_after: "-401.74",
        status: "PLANNED",
        source: "rule",
        type: "expense",
      }),
      timelineRow({
        date: "2026-08-26",
        description: "Venture C/C Payment",
        amount: "-100.00",
        running_balance: "200.29",
        balance_after: "-501.74",
        status: "PLANNED",
        source: "rule",
        type: "expense",
      }),
    ];
    const upcoming = [
      timelineRow({
        date: "2026-08-27",
        description: "Move to Savings",
        amount: "-497.00",
        running_balance: "-1406.40",
        balance_after: "-998.74",
        type: "expense",
      }),
    ];

    const rows = buildTransactionListRows({
      history,
      pending,
      upcoming,
      balanceMap: new Map(),
      filters: { ...DEFAULT_TRANSACTION_FILTERS, accountId: 1 },
      today: "2026-08-26",
    });

    const pendingRows = rows.filter((r) => r.kind === "pending");
    const upcomingRows = rows.filter((r) => r.kind === "upcoming");

    expect(pendingRows[0].kind === "pending" && pendingRows[0].runningBalance).toBe("1.69");
    expect(pendingRows[1].kind === "pending" && pendingRows[1].runningBalance).toBe("-401.74");
    expect(pendingRows[2].kind === "pending" && pendingRows[2].runningBalance).toBe("-501.74");
    expect(upcomingRows[0].kind === "upcoming" && upcomingRows[0].runningBalance).toBe("-998.74");
  });

  it("prefers balance_after over running_balance", () => {
    expect(
      timelineRowLedgerBalance(
        timelineRow({
          date: "2026-08-27",
          description: "X",
          amount: "-1",
          running_balance: "999",
          balance_after: "12.34",
        })
      )
    ).toBe("12.34");
  });
});

describe("no client-side ledger balance math", () => {
  it("buildTransactionList source does not sum amounts for Bal", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "buildTransactionList.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/continueLedgerBalances/);
    expect(src).not.toMatch(/signedTimelineLedgerAmount/);
    expect(src).not.toMatch(/running\s*=\s*running\s*\+/);
    expect(src).toMatch(/timelineRowLedgerBalance/);
    expect(src).toMatch(/balance_after/);
  });

  it("useTransactionsData does not pass ledger_anchor to getTimeline", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "useTransactionsData.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/ledger_anchor\s*:/);
    expect(src).toMatch(/getTimeline/);
  });
});
