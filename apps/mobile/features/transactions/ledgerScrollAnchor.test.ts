import { describe, expect, it } from "vitest";
import type { Transaction } from "@budget-app/shared";
import type { TransactionListRow } from "./buildTransactionList";
import {
  LEDGER_ANCHOR_PAST_ROWS,
  LEDGER_ROW_HEIGHT,
  LEDGER_SECTION_HEIGHT,
  estimateLedgerOffset,
  findLedgerBoundaryIndex,
  ledgerAnchorScrollIndex,
} from "./ledgerScrollAnchor";

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
});
