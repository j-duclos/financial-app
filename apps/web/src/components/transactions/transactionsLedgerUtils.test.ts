import { describe, it, expect } from "vitest";
import {
  buildLedgerRows,
  buildLedgerRowsFromTimeline,
  splitLedgerSections,
  formatDateDisplay,
  todayStr,
} from "./transactionsLedgerUtils";
import type { TimelineRow } from "@budget-app/shared";

describe("formatDateDisplay", () => {
  it("formats ISO date as MM-DD-YYYY", () => {
    expect(formatDateDisplay("2026-05-23")).toBe("05-23-2026");
  });
});

describe("buildLedgerRowsFromTimeline", () => {
  const today = todayStr();

  it("splits past, today, and future rows", () => {
    const timeline: TimelineRow[] = [
      {
        date: "2020-01-01",
        description: "Old",
        account_id: 1,
        account_name: "Checking",
        category_id: null,
        category_name: null,
        amount: "100",
        type: "INFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 1,
        running_balance: "100",
      },
      {
        date: today,
        description: "Today txn",
        account_id: 1,
        account_name: "Checking",
        category_id: null,
        category_name: null,
        amount: "-50",
        type: "OUTFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 2,
        running_balance: "50",
      },
      {
        date: "2099-12-31",
        description: "Future",
        account_id: 1,
        account_name: "Checking",
        category_id: null,
        category_name: null,
        amount: "-10",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "rule",
        rule_id: 5,
        transaction_id: 3,
        running_balance: "40",
      },
    ];

    const rows = buildLedgerRowsFromTimeline(timeline, today, 0, false);
    const sections = splitLedgerSections(rows);

    expect(sections.start?.type).toBe("starting_balance");
    expect(sections.past).toHaveLength(2);
    expect(sections.today?.balance).toBe(50);
    expect(sections.future).toHaveLength(1);
    expect(sections.future[0].type).toBe("recurring");
  });
});

describe("buildLedgerRows fallback", () => {
  it("inserts today balance before first future transaction", () => {
    const futureDate = "2099-06-01";
    const rows = buildLedgerRows(
      [
        {
          id: 1,
          date: "2020-01-01",
          payee: "Deposit",
          amount: "100",
          direction: "INFLOW",
        } as never,
        {
          id: 2,
          date: futureDate,
          payee: "Rent",
          amount: "-50",
          direction: "OUTFLOW",
        } as never,
      ],
      0,
      "USD",
      false
    );
    const todayIdx = rows.findIndex((r) => r.type === "today_balance");
    const futureIdx = rows.findIndex((r) => r.type === "transaction" && r.txn.date === futureDate);
    expect(todayIdx).toBeGreaterThan(-1);
    expect(todayIdx).toBeLessThan(futureIdx);
  });
});
