import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@budget-app/shared";
import {
  buildLedgerRowsFromPastAndUpcomingTimeline,
  splitLedgerSections,
  timelineRowLedgerBalance,
} from "./transactionsLedgerUtils";

const ledgerUtilsSource = readFileSync(new URL("./transactionsLedgerUtils.ts", import.meta.url), "utf8");

function futureRow(partial: Partial<TimelineRow> & Pick<TimelineRow, "description" | "amount" | "balance_after">): TimelineRow {
  return {
    date: "2026-09-11",
    account_id: 1,
    type: "OUTFLOW",
    status: "PLANNED",
    source: "actual",
    txn_source: "ACTUAL",
    ...partial,
  } as TimelineRow;
}

describe("canonical future ledger display", () => {
  it("shows a future manual expense using backend balance_after 800, not a client walk", () => {
    const today = "2026-09-10";
    const upcoming: TimelineRow[] = [
      futureRow({
        description: "Manual grocery",
        amount: "-200.00",
        type: "OUTFLOW",
        balance_after: "800.00",
        transaction_id: 101,
      }),
    ];
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline([], upcoming, today, 1000, false);
    const { future } = splitLedgerSections(rows);
    expect(future).toHaveLength(1);
    expect(future[0].type).toBe("recurring");
    if (future[0].type === "recurring") {
      expect(future[0].row.amount).toBe("-200.00");
      expect(future[0].balance).toBe(800);
      expect(timelineRowLedgerBalance(future[0].row)).toBe(800);
    }
  });

  it("shows future manual income using backend balance_after 1500", () => {
    const today = "2026-09-10";
    const upcoming: TimelineRow[] = [
      futureRow({
        description: "Bonus",
        amount: "500.00",
        type: "INFLOW",
        balance_after: "1500.00",
        transaction_id: 102,
      }),
    ];
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline([], upcoming, today, 1000, false);
    const { future } = splitLedgerSections(rows);
    expect(future[0].balance).toBe(1500);
  });

  it("displays recurring + manual Bal values from backend balance_after only", () => {
    const today = "2026-09-10";
    const upcoming: TimelineRow[] = [
      futureRow({
        date: "2026-09-11",
        description: "Paycheck",
        amount: "2000.00",
        type: "INFLOW",
        source: "rule",
        txn_source: "RULE",
        rule_id: 1,
        balance_after: "3000.00",
      }),
      futureRow({
        date: "2026-09-12",
        description: "Rent",
        amount: "-1500.00",
        source: "rule",
        txn_source: "RULE",
        rule_id: 2,
        balance_after: "1500.00",
      }),
      futureRow({
        date: "2026-09-13",
        description: "Planned purchase",
        amount: "-200.00",
        source: "one_time",
        txn_source: "ONE_TIME",
        balance_after: "1300.00",
        transaction_id: 200,
      }),
    ];
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline([], upcoming, today, 1000, false);
    const { future } = splitLedgerSections(rows);
    expect(future.map((r) => r.balance)).toEqual([3000, 1500, 1300]);
  });

  it("joins sealed recon history with canonical future without recomputing opening", () => {
    const today = "2026-09-10";
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline(
      [
        {
          id: 1,
          date: "2026-08-17",
          payee: "Papa Johns",
          amount: "-27.13",
          status: "RECONCILED",
          reconciled: true,
        } as never,
        {
          id: 2,
          date: "2026-08-18",
          payee: "Coffee",
          amount: "-10.00",
          status: "CLEARED",
          reconciled: false,
          running_balance: "990.00",
        } as never,
      ],
      [
        futureRow({
          description: "Future bill",
          amount: "-200.00",
          balance_after: "790.00",
          transaction_id: 9,
        }),
      ],
      today,
      1000,
      false,
      {
        pastOpeningOverride: 1000,
        checkpointPeriodEnd: "2026-08-17",
      }
    );
    const sections = splitLedgerSections(rows);
    expect(sections.start?.balance).toBe(1000);
    expect(sections.past[0].balance).toBeNull();
    expect(sections.past[1].balance).toBe(990);
    expect(sections.future[0].balance).toBe(790);
  });

  it("does not reconstruct Upcoming Bal from previous + amount", () => {
    const start = ledgerUtilsSource.indexOf(
      "export function buildLedgerRowsFromPastAndUpcomingTimeline"
    );
    const next = ledgerUtilsSource.indexOf("export function timelineHasAccountRows");
    const body = ledgerUtilsSource.slice(start, next);
    expect(body).not.toMatch(/applyTimelineAmountToBalance/);
    expect(body).not.toMatch(/futurePostedTransactions/);
    expect(body).toMatch(/timelineRowLedgerBalance/);
  });
});
