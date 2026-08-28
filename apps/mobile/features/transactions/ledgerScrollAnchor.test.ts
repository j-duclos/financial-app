import { describe, expect, it } from "vitest";
import type { Transaction } from "@budget-app/shared";
import type { TransactionListRow } from "./buildTransactionList";
import {
  LEDGER_ANCHOR_PAST_ROWS,
  LEDGER_ROW_HEIGHT,
  LEDGER_SECTION_HEIGHT,
  estimateLedgerOffset,
  findLedgerBoundaryIndex,
  findLedgerFocusIndex,
  ledgerAnchorScrollIndex,
  ledgerOpenScrollIndex,
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

  it("returns null when there is no Pending or Upcoming", () => {
    const rows: TransactionListRow[] = [section("section-recent", "Recent"), history(1)];
    expect(findLedgerBoundaryIndex(rows)).toBeNull();
    expect(ledgerAnchorScrollIndex(rows)).toBeNull();
  });

  it(`scrolls so about ${LEDGER_ANCHOR_PAST_ROWS} history rows sit above the boundary`, () => {
    const rows: TransactionListRow[] = [
      section("section-recent", "Recent"),
      ...Array.from({ length: 10 }, (_, i) => history(i + 1)),
      section("section-pending", "Pending"),
    ];
    // boundary at 11; 4 history rows above → indices 7,8,9,10 then pending
    expect(ledgerAnchorScrollIndex(rows)).toBe(7);
  });

  it("clamps when fewer than four history rows exist", () => {
    const rows: TransactionListRow[] = [
      section("section-recent", "Recent"),
      history(1),
      history(2),
      section("section-pending", "Pending"),
    ];
    expect(ledgerAnchorScrollIndex(rows)).toBe(1);
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
    expect(ledgerOpenScrollIndex(rows, null)).toBe(ledgerAnchorScrollIndex(rows));
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
});
