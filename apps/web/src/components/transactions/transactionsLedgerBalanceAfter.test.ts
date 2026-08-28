import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@budget-app/shared";
import {
  buildLedgerRowsFromPastAndUpcomingTimeline,
  splitLedgerSections,
  timelineRowLedgerBalance,
} from "./transactionsLedgerUtils";

describe("timelineRowLedgerBalance", () => {
  it("returns parsed balance_after without client arithmetic", () => {
    const row = {
      date: "2026-08-28",
      description: "Gen's Rent",
      account_id: 1,
      amount: "1500.00",
      balance_after: "3284.18",
    } as TimelineRow;
    expect(timelineRowLedgerBalance(row)).toBe(3284.18);
  });
});

describe("buildLedgerRowsFromPastAndUpcomingTimeline forecast rows", () => {
  it("displays backend balance_after for Aug 28 sequence without recalculation", () => {
    const today = "2026-08-27";
    const aug28 = "2026-08-28";
    const upcoming: TimelineRow[] = [
      {
        date: aug28,
        description: "Gen's Rent",
        account_id: 1,
        amount: "1500.00",
        type: "INFLOW",
        status: "PLANNED",
        source: "one_time",
        txn_source: "one_time",
        balance_after: "3284.18",
      } as TimelineRow,
      {
        date: aug28,
        description: "Rent",
        account_id: 1,
        amount: "-3100.00",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "one_time",
        txn_source: "one_time",
        balance_after: "184.18",
      } as TimelineRow,
      {
        date: aug28,
        description: "Lou",
        account_id: 1,
        amount: "500.00",
        type: "INFLOW",
        status: "PLANNED",
        source: "one_time",
        txn_source: "one_time",
        balance_after: "684.18",
      } as TimelineRow,
      {
        date: aug28,
        description: "Electric bill",
        account_id: 1,
        amount: "-405.00",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "one_time",
        txn_source: "one_time",
        balance_after: "279.18",
      } as TimelineRow,
      {
        date: aug28,
        description: "Water Bill",
        account_id: 1,
        amount: "-180.00",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "one_time",
        txn_source: "one_time",
        balance_after: "99.18",
      } as TimelineRow,
    ];

    const rows = buildLedgerRowsFromPastAndUpcomingTimeline(
      [
        {
          id: 1,
          date: today,
          payee: "Anchor",
          amount: "0",
          running_balance: "1784.18",
          source: "PLAID",
        } as never,
      ],
      upcoming,
      today,
      1784.18,
      false
    );

    const { future } = splitLedgerSections(rows);
    const byDesc = Object.fromEntries(
      future
        .filter((r) => r.type === "recurring")
        .map((r) => [r.row.description, r.balance])
    );
    expect(byDesc["Gen's Rent"]).toBe(3284.18);
    expect(byDesc["Rent"]).toBe(184.18);
    expect(byDesc["Lou"]).toBe(684.18);
    expect(byDesc["Electric bill"]).toBe(279.18);
    expect(byDesc["Water Bill"]).toBe(99.18);
  });

  it("does not send ledger_anchor from web Transactions page", () => {
    const src = readFileSync(
      new URL("../../pages/Transactions.tsx", import.meta.url),
      "utf8"
    );
    expect(src).not.toMatch(/ledger_anchor/);
  });
});
