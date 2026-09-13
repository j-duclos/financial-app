import { describe, expect, it } from "vitest";
import type { Transaction } from "@budget-app/shared";
import type { TransactionListRow } from "./buildTransactionList";
import {
  LEDGER_ORDINARY_OPEN_INDEX,
  LEDGER_ROW_HEIGHT,
  LEDGER_SECTION_HEIGHT,
  estimateLedgerOffset,
  findDefaultLedgerOpenIndex,
  findLedgerBoundaryIndex,
  isLedgerActivityRow,
  findLedgerFocusIndex,
  firstSearchParam,
  ledgerAnchorScrollIndex,
  ledgerOpenScrollIndex,
  ordinaryLedgerPositionKey,
  resolveLedgerOpenMode,
  shouldApplyFocusScroll,
  shouldApplyOrdinaryProgrammaticScroll,
} from "./ledgerScrollAnchor";
import type { TimelineRow } from "@budget-app/shared";

function history(id: number): TransactionListRow {
  const txn = {
    id,
    payee: `Txn ${id}`,
    amount: "-10.00",
    date: "2026-08-01",
  } as Transaction;
  return {
    kind: "history",
    id: `history-${id}`,
    txn,
    runningBalance: "100.00",
  };
}

function section(id: string, title: string): TransactionListRow {
  return { kind: "section", id, title };
}

describe("ledgerScrollAnchor", () => {
  it("finds Pending boundary before Upcoming", () => {
    const rows: TransactionListRow[] = [
      section("section-recent", "Recent"),
      history(1),
      history(2),
      section("section-pending", "Pending"),
      section("section-upcoming", "Upcoming"),
    ];
    expect(findLedgerBoundaryIndex(rows)).toBe(3);
  });

  it("falls back to Upcoming when Pending is absent", () => {
    const rows: TransactionListRow[] = [
      section("section-recent", "Recent"),
      history(1),
      section("section-upcoming", "Upcoming"),
    ];
    expect(findLedgerBoundaryIndex(rows)).toBe(2);
  });

  it("returns null boundary when there is no Pending or Upcoming", () => {
    const rows: TransactionListRow[] = [section("section-recent", "Recent"), history(1)];
    expect(findLedgerBoundaryIndex(rows)).toBeNull();
  });

  it("ordinary open is always the top of the list, regardless of Pending or Upcoming", () => {
    const withPending: TransactionListRow[] = [
      section("section-recent", "Recent"),
      ...Array.from({ length: 8 }, (_, i) => history(i + 1)),
      section("section-pending", "Pending"),
      {
        kind: "pending",
        id: "pending-1",
        row: { date: "2026-08-28", description: "Rent", amount: "-100.00" } as TimelineRow,
        runningBalance: "500.00",
      },
      section("section-upcoming", "Upcoming"),
      {
        kind: "upcoming",
        id: "upcoming-1",
        row: { date: "2026-09-20", description: "Bill", amount: "-20.00" } as TimelineRow,
        runningBalance: "480.00",
      },
    ];
    const noPending: TransactionListRow[] = [
      section("section-recent", "Recent"),
      ...Array.from({ length: 8 }, (_, i) => history(i + 1)),
      section("section-upcoming", "Upcoming"),
    ];
    const onlyRecent: TransactionListRow[] = [
      section("section-recent", "Recent"),
      ...Array.from({ length: 10 }, (_, i) => history(i + 1)),
    ];
    const manyHistory: TransactionListRow[] = [
      section("section-recent", "Recent"),
      ...Array.from({ length: 40 }, (_, i) => history(i + 1)),
      section("section-upcoming", "Upcoming"),
    ];
    expect(LEDGER_ORDINARY_OPEN_INDEX).toBe(0);
    expect(findDefaultLedgerOpenIndex(withPending)).toBe(0);
    expect(findDefaultLedgerOpenIndex(noPending)).toBe(0);
    expect(findDefaultLedgerOpenIndex(onlyRecent)).toBe(0);
    expect(findDefaultLedgerOpenIndex(manyHistory)).toBe(0);
    expect(findDefaultLedgerOpenIndex([])).toBe(0);
    expect(ledgerAnchorScrollIndex(withPending)).toBe(0);
    expect(ledgerOpenScrollIndex(withPending, null)).toBe(0);
  });

  it("treats only history, pending, and upcoming as activity rows", () => {
    expect(isLedgerActivityRow(history(1))).toBe(true);
    expect(
      isLedgerActivityRow({
        kind: "pending",
        id: "p",
        row: { date: "2026-08-28", description: "Rent", amount: "-1" } as TimelineRow,
        runningBalance: "1.00",
      })
    ).toBe(true);
    expect(
      isLedgerActivityRow({
        kind: "upcoming",
        id: "u",
        row: { date: "2026-09-20", description: "Bill", amount: "-1" } as TimelineRow,
        runningBalance: "1.00",
      })
    ).toBe(true);
    expect(isLedgerActivityRow(section("section-recent", "Recent"))).toBe(false);
    expect(isLedgerActivityRow({ kind: "skeleton", id: "sk", section: "recent" })).toBe(false);
    expect(isLedgerActivityRow({ kind: "message", id: "m", text: "x" })).toBe(false);
    expect(isLedgerActivityRow({ kind: "loadOlder", id: "lo", loading: false })).toBe(false);
  });

  it("estimates offset from section + row heights", () => {
    const rows: TransactionListRow[] = [
      section("section-recent", "Recent"),
      history(1),
      history(2),
      section("section-pending", "Pending"),
    ];
    expect(estimateLedgerOffset(rows, 0)).toBe(0);
    expect(estimateLedgerOffset(rows, 1)).toBe(LEDGER_SECTION_HEIGHT);
    expect(estimateLedgerOffset(rows, 3)).toBe(
      LEDGER_SECTION_HEIGHT + LEDGER_ROW_HEIGHT * 2
    );
  });

  it("forecast-risk deep link prefers the exact upcoming transaction row", () => {
    const upcomingRow = {
      kind: "upcoming" as const,
      id: "upcoming-99",
      row: {
        date: "2026-09-02",
        description: "Exeterfina Loan",
        transaction_id: 99,
      } as TimelineRow,
      runningBalance: "-378.80",
    };
    const rows: TransactionListRow[] = [
      section("section-recent", "Recent"),
      history(1),
      section("section-upcoming", "Upcoming"),
      upcomingRow,
    ];
    const focus = {
      focus: "forecast-risk" as const,
      focusDate: "2026-09-02",
      focusTransactionId: 99,
    };
    expect(findLedgerFocusIndex(rows, focus)).toBe(3);
    expect(ledgerOpenScrollIndex(rows, focus)).toBe(3);
    expect(ledgerOpenScrollIndex(rows, null)).toBe(0);
  });

  it("ledger-event deep link matches rule id and date when transaction id is absent", () => {
    const rows: TransactionListRow[] = [
      section("section-upcoming", "Upcoming"),
      {
        kind: "upcoming",
        id: "upcoming-rule",
        row: {
          date: "2026-09-02",
          description: "Paycheck",
          transaction_id: null,
          rule_id: 5,
        } as TimelineRow,
        runningBalance: "2000.00",
      },
    ];
    expect(
      findLedgerFocusIndex(rows, {
        focus: "ledger-event",
        focusDate: "2026-09-02",
        focusTransactionId: null,
        focusRuleId: 5,
      })
    ).toBe(1);
  });

  it("forecast-risk falls back to first upcoming row on focusDate", () => {
    const rows: TransactionListRow[] = [
      section("section-upcoming", "Upcoming"),
      {
        kind: "upcoming",
        id: "upcoming-date",
        row: { date: "2026-09-02", description: "Bill", transaction_id: null } as TimelineRow,
        runningBalance: "-10.00",
      },
    ];
    expect(
      findLedgerFocusIndex(rows, {
        focus: "forecast-risk",
        focusDate: "2026-09-02",
        focusTransactionId: null,
      })
    ).toBe(1);
  });

  it("date fallback finds Aug 30 pending before later Sep rows", () => {
    const rows: TransactionListRow[] = [
      section("section-upcoming", "Upcoming"),
      {
        kind: "upcoming",
        id: "vivint",
        row: {
          date: "2026-08-30",
          description: "VIVINT",
          transaction_id: 50,
        } as TimelineRow,
        runningBalance: "4.99",
      },
      {
        kind: "upcoming",
        id: "exeter",
        row: {
          date: "2026-09-02",
          description: "Exeterfina Loan",
          transaction_id: 99,
        } as TimelineRow,
        runningBalance: "-388.80",
      },
      {
        kind: "upcoming",
        id: "hulu",
        row: {
          date: "2026-09-04",
          description: "Hulu",
          transaction_id: 120,
        } as TimelineRow,
        runningBalance: "-532.54",
      },
    ];
    expect(
      ledgerOpenScrollIndex(rows, {
        focus: "ledger-event",
        focusDate: "2026-08-30",
        focusTransactionId: 50,
      })
    ).toBe(1);
    expect(
      ledgerOpenScrollIndex(rows, {
        focus: "ledger-event",
        focusDate: "2026-08-30",
        focusTransactionId: null,
      })
    ).toBe(1);
  });

  it("ignores a stale transaction id when focusDate is a different day", () => {
    const rows: TransactionListRow[] = [
      section("section-upcoming", "Upcoming"),
      {
        kind: "upcoming",
        id: "vivint",
        row: {
          date: "2026-08-30",
          description: "VIVINT",
          transaction_id: 50,
        } as TimelineRow,
        runningBalance: "4.99",
      },
      {
        kind: "upcoming",
        id: "hulu",
        row: {
          date: "2026-09-04",
          description: "Hulu",
          transaction_id: 120,
        } as TimelineRow,
        runningBalance: "-532.54",
      },
    ];
    // Stale Sep 4 id from a prior Attention tap + Aug 30 date/description from Money Flow.
    expect(
      findLedgerFocusIndex(rows, {
        focus: "ledger-event",
        focusDate: "2026-08-30",
        focusTransactionId: 120,
        focusDescription: "VIVINT",
      })
    ).toBe(1);
  });

  it("matches date + description when transaction id is missing", () => {
    const rows: TransactionListRow[] = [
      section("section-upcoming", "Upcoming"),
      {
        kind: "upcoming",
        id: "vivint",
        row: {
          date: "2026-08-30",
          description: "VIVINT SMART HOME",
          transaction_id: null,
        } as TimelineRow,
        runningBalance: "4.99",
      },
      {
        kind: "upcoming",
        id: "hulu",
        row: {
          date: "2026-09-04",
          description: "Hulu",
          transaction_id: null,
        } as TimelineRow,
        runningBalance: "-10.00",
      },
    ];
    expect(
      findLedgerFocusIndex(rows, {
        focus: "ledger-event",
        focusDate: "2026-08-30",
        focusTransactionId: null,
        focusDescription: "VIVINT",
      })
    ).toBe(1);
  });

  it("firstSearchParam uses the latest array value (Expo param accumulation)", () => {
    expect(firstSearchParam(["120", "50"])).toBe("50");
    expect(firstSearchParam(["forecast-risk", "ledger-event"])).toBe("ledger-event");
    expect(firstSearchParam(["120", "__none__"])).toBe("");
    expect(firstSearchParam("__none__")).toBe("");
  });
});

describe("ledger open modes", () => {
  it("separates ordinary opening from explicit deep-link focus", () => {
    expect(resolveLedgerOpenMode(null)).toBe("ordinary");
    expect(resolveLedgerOpenMode(undefined)).toBe("ordinary");
    expect(resolveLedgerOpenMode({ focus: "forecast-risk", focusDate: "2026-09-02" })).toBe(
      "focus"
    );
    expect(resolveLedgerOpenMode({ focus: "ledger-event", focusTransactionId: 9 })).toBe("focus");
  });

  it("never allows delayed ordinary programmatic scroll", () => {
    expect(shouldApplyOrdinaryProgrammaticScroll()).toBe(false);
  });

  it("missing deep-link target falls back to the top, not a boundary anchor", () => {
    const rows: TransactionListRow[] = [
      section("section-recent", "Recent"),
      history(1),
      section("section-pending", "Pending"),
      section("section-upcoming", "Upcoming"),
    ];
    expect(
      ledgerOpenScrollIndex(
        rows,
        { focus: "forecast-risk", focusDate: "2099-01-01", focusTransactionId: 999 },
        { allowDefaultWhenFocusMissing: true }
      )
    ).toBe(0);
    expect(
      ledgerOpenScrollIndex(rows, {
        focus: "forecast-risk",
        focusDate: "2099-01-01",
        focusTransactionId: 999,
      })
    ).toBeNull();
  });

  it("blocks focus scroll after the user starts dragging or the target was already placed", () => {
    expect(
      shouldApplyFocusScroll({
        userHasDragged: true,
        appliedKey: null,
        attemptKey: "a:1",
      })
    ).toBe(false);
    expect(
      shouldApplyFocusScroll({
        userHasDragged: false,
        appliedKey: "a:1",
        attemptKey: "a:1",
      })
    ).toBe(false);
    expect(
      shouldApplyFocusScroll({
        userHasDragged: false,
        appliedKey: null,
        attemptKey: "a:1",
      })
    ).toBe(true);
  });

  it("keys ordinary position by account, recent range, and forecast window", () => {
    expect(
      ordinaryLedgerPositionKey({ accountId: 3, timeFilter: "14d", forecastDays: 90 })
    ).toBe("3:14d:90");
    expect(
      ordinaryLedgerPositionKey({ accountId: 4, timeFilter: "14d", forecastDays: 90 })
    ).not.toBe(
      ordinaryLedgerPositionKey({ accountId: 3, timeFilter: "14d", forecastDays: 90 })
    );
    expect(
      ordinaryLedgerPositionKey({ accountId: 3, timeFilter: "30d", forecastDays: 90 })
    ).not.toBe("3:14d:90");
  });
});
