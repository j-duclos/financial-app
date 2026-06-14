import { describe, it, expect } from "vitest";
import {
  buildLedgerRows,
  buildLedgerRowsFromTimeline,
  creditBalanceColorClass,
  ledgerOpeningBalance,
  accountLedgerDisplayBalance,
  resolveLedgerOpening,
  isForecastTimelineRow,
  isPastTimelineRow,
  isProjectedInterestRow,
  isSupersededPlannedTimelineRow,
  creditOwedAsOfDateFromTimeline,
  creditCardSignedBalanceAtDate,
  splitLedgerSections,
  resolveFallbackLedgerOpening,
  formatDateDisplay,
  todayStr,
  timelineRangeForFilter,
  projectionTimelineRangeForAsOf,
  addDaysToIsoDate,
  timelineHasAccountRows,
} from "./transactionsLedgerUtils";
import type { TimelineRow } from "@budget-app/shared";

describe("timelineRangeForFilter", () => {
  it("uses a symmetric 14-day window", () => {
    const today = todayStr();
    const { start, end } = timelineRangeForFilter("14d");
    expect(start).toBe(addDaysToIsoDate(today, -14));
    expect(end).toBe(addDaysToIsoDate(today, 14));
  });
});

describe("projectionTimelineRangeForAsOf", () => {
  it("uses ~3 years of history and no long future horizon", () => {
    const today = todayStr();
    const { start, end, as_of } = projectionTimelineRangeForAsOf("2020-06-15");
    expect(as_of).toBe(today);
    expect(start).toBe(addDaysToIsoDate(as_of, -1095));
    expect(end).toBe(addDaysToIsoDate(as_of, 1));
  });
});

describe("creditBalanceColorClass", () => {
  it("uses red for credit debt and gray for zero", () => {
    expect(creditBalanceColorClass(true, 351.79)).toBe("text-red-600");
    expect(creditBalanceColorClass(true, 0)).toBe("text-gray-500");
    expect(creditBalanceColorClass(false, 100)).toBe("text-gray-900");
  });
});

describe("ledgerOpeningBalance", () => {
  it("respects zero starting balance on credit cards", () => {
    expect(ledgerOpeningBalance("0", true)).toBe(0);
    expect(ledgerOpeningBalance("0.00", true)).toBe(0);
    expect(ledgerOpeningBalance(null, true)).toBe(0);
  });
});

describe("resolveLedgerOpening", () => {
  it("ignores stale starting_balance on bank accounts when timeline exists", () => {
    const row: TimelineRow = {
      date: "2025-01-01",
      description: "Deposit",
      account_id: 1,
      account_name: "Chase",
      category_id: null,
      category_name: null,
      amount: "50",
      type: "INFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 1,
      running_balance: "100",
    };
    expect(resolveLedgerOpening(983.43, row, false)).toBe(50);
  });
});

describe("accountLedgerDisplayBalance", () => {
  it("uses available_balance for bank accounts", () => {
    expect(
      accountLedgerDisplayBalance({ available_balance: "1385.78", balance: "999" }, false)
    ).toBe(1385.78);
  });

  it("falls back to forecast_summary when balance fields are missing", () => {
    expect(
      accountLedgerDisplayBalance({ forecast_summary: { current_balance: "408.65" } }, false)
    ).toBe(408.65);
  });

  it("uses signed balance when credit balance_owed is stale zero", () => {
    expect(
      accountLedgerDisplayBalance({ balance_owed: "0", balance: "-500.00" }, true)
    ).toBe(500);
  });
});

describe("formatDateDisplay", () => {
  it("formats ISO date as MM-DD-YY", () => {
    expect(formatDateDisplay("2026-05-23")).toBe("05-23-26");
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

  it("puts today planned rule rows in past, not forecast", () => {
    const timeline: TimelineRow[] = [
      {
        date: today,
        description: "Geico",
        account_id: 1,
        account_name: "Checking",
        category_id: 10,
        category_name: "Auto Insurance",
        amount: "-403.43",
        type: "OUTFLOW",
        status: "PLANNED",
        source: "rule",
        rule_id: 1,
        transaction_id: 99,
        running_balance: "800",
      },
      {
        date: today,
        description: "Coffee",
        account_id: 1,
        account_name: "Checking",
        category_id: null,
        category_name: "Food",
        amount: "-5",
        type: "OUTFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 2,
        running_balance: "795",
      },
    ];

    expect(isForecastTimelineRow(timeline[0], today)).toBe(false);
    expect(isForecastTimelineRow(timeline[1], today)).toBe(false);

    const sections = splitLedgerSections(buildLedgerRowsFromTimeline(timeline, today, 0, false));
    expect(sections.past).toHaveLength(2);
    expect(sections.future).toHaveLength(0);
  });

  it("uses past opening override when all past rows are hidden", () => {
    const today = todayStr();
    const sections = splitLedgerSections(
      buildLedgerRowsFromTimeline([], today, 0.12, false, 4.15)
    );
    expect(sections.start?.balance).toBeCloseTo(4.15, 2);
    expect(sections.past).toHaveLength(0);
    expect(sections.today?.balance).toBeCloseTo(4.15, 2);
  });

  it("never places projected interest in past section", () => {
    const today = todayStr();
    const pastInterest: TimelineRow = {
      date: addDaysToIsoDate(today, -14),
      description: "Projected Interest",
      account_id: 11,
      account_name: "Amazon",
      category_id: 1,
      category_name: "Interest",
      amount: "-22.71",
      type: "OUTFLOW",
      status: "planned",
      source: "interest",
      rule_id: null,
      transaction_id: null,
      running_balance: "-1022.71",
    };
    const futureInterest: TimelineRow = {
      date: addDaysToIsoDate(today, 14),
      description: "Projected Interest",
      account_id: 11,
      account_name: "Amazon",
      category_id: 1,
      category_name: "Interest",
      amount: "-23.00",
      type: "OUTFLOW",
      status: "planned",
      source: "interest",
      rule_id: null,
      transaction_id: null,
      running_balance: "-1045.71",
    };
    expect(isProjectedInterestRow(pastInterest)).toBe(true);
    expect(isPastTimelineRow(pastInterest, today)).toBe(false);
    expect(isPastTimelineRow(futureInterest, today)).toBe(false);
    expect(isForecastTimelineRow(futureInterest, today)).toBe(true);

    const sections = splitLedgerSections(
      buildLedgerRowsFromTimeline([pastInterest, futureInterest], today, 1000, true)
    );
    expect(sections.past).toHaveLength(0);
    expect(sections.future).toHaveLength(1);
    if (sections.future[0].type === "recurring") {
      expect(sections.future[0].row.description).toBe("Projected Interest");
    }
  });

  it("recomputes bank balance on visible past rows when duplicate planned is hidden", () => {
    const gyro: TimelineRow = {
      date: today,
      description: "Gyro Grill",
      account_id: 1,
      account_name: "Chase",
      category_id: null,
      category_name: null,
      amount: "-46.96",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 10,
      running_balance: "1385.78",
    };
    const plannedPay: TimelineRow = {
      date: today,
      description: "Amazon",
      account_id: 1,
      account_name: "Chase",
      category_id: 1,
      category_name: "Credit Card Payment",
      amount: "-100",
      type: "OUTFLOW",
      status: "PLANNED",
      source: "rule",
      rule_id: 9,
      transaction_id: 20,
      running_balance: "1285.78",
    };
    const clearedPay: TimelineRow = {
      date: today,
      description: "Amazon",
      account_id: 1,
      account_name: "Chase",
      category_id: 1,
      category_name: "Credit Card Payment",
      amount: "-100",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 21,
      running_balance: "1185.78",
    };
    const frys: TimelineRow = {
      date: today,
      description: "Frys",
      account_id: 1,
      account_name: "Chase",
      category_id: null,
      category_name: null,
      amount: "-177.13",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 22,
      running_balance: "1008.65",
    };
    const opening = 1385.78 + 46.96;
    const sections = splitLedgerSections(
      buildLedgerRowsFromTimeline([gyro, plannedPay, clearedPay, frys], today, opening, false)
    );
    const pastBalances = sections.past
      .filter((r) => r.type === "transaction_from_timeline")
      .map((r) => (r.type === "transaction_from_timeline" ? r.balance : 0));
    expect(pastBalances).toHaveLength(3);
    expect(pastBalances[0]).toBeCloseTo(1385.78, 2);
    expect(pastBalances[1]).toBeCloseTo(1285.78, 2);
    expect(pastBalances[2]).toBeCloseTo(1108.65, 2);
    expect(sections.today?.balance).toBeCloseTo(1108.65, 2);
  });

  it("drops superseded planned row when cleared payment exists same day", () => {
    const planned: TimelineRow = {
      date: today,
      description: "Amazon",
      account_id: 11,
      account_name: "Amazon",
      category_id: 1,
      category_name: "Credit Card Payment",
      amount: "100",
      type: "INFLOW",
      status: "PLANNED",
      source: "rule",
      rule_id: 9,
      transaction_id: 20,
      running_balance: "-251.79",
    };
    const cleared: TimelineRow = {
      date: today,
      description: "Amazon",
      account_id: 11,
      account_name: "Amazon",
      category_id: 1,
      category_name: "Credit Card Payment",
      amount: "100",
      type: "INFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 21,
      running_balance: "-351.79",
    };
    expect(isSupersededPlannedTimelineRow(planned, [planned, cleared])).toBe(true);
    expect(isSupersededPlannedTimelineRow(cleared, [planned, cleared])).toBe(false);
  });

  it("does not invent opening balance from signed API running_balance", () => {
    const timeline: TimelineRow[] = [
      {
        date: "2025-12-09",
        description: "Amazon",
        account_id: 11,
        account_name: "Amazon",
        category_id: null,
        category_name: null,
        amount: "-32.74",
        type: "OUTFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 1,
        running_balance: "-32.74",
      },
    ];
    const sections = splitLedgerSections(buildLedgerRowsFromTimeline(timeline, today, 0, true));
    expect(sections.start?.balance).toBe(0);
    expect(sections.past[0].type).toBe("transaction_from_timeline");
    if (sections.past[0].type === "transaction_from_timeline") {
      expect(sections.past[0].balance).toBeCloseTo(32.74, 2);
    }
  });

  it("recomputes past balance when a duplicate payment is hidden in forecast", () => {
    const timeline: TimelineRow[] = [
      {
        date: "2026-05-14",
        description: "Amazon",
        account_id: 11,
        account_name: "Amazon",
        category_id: null,
        category_name: null,
        amount: "-10.91",
        type: "OUTFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 2,
        running_balance: "-451.79",
      },
      {
        date: today,
        description: "Amazon",
        account_id: 11,
        account_name: "Amazon",
        category_id: 1,
        category_name: "Credit Card Payment",
        amount: "100",
        type: "INFLOW",
        status: "PLANNED",
        source: "rule",
        rule_id: 9,
        transaction_id: 20,
        running_balance: "-251.79",
      },
      {
        date: today,
        description: "Amazon",
        account_id: 11,
        account_name: "Amazon",
        category_id: 1,
        category_name: "Credit Card Payment",
        amount: "100",
        type: "INFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 21,
        running_balance: "-351.79",
      },
    ];

    const sections = splitLedgerSections(buildLedgerRowsFromTimeline(timeline, today, 0, true));
    const lastPast = sections.past[sections.past.length - 1];
    expect(lastPast.type).toBe("transaction_from_timeline");
    if (lastPast.type === "transaction_from_timeline") {
      expect(lastPast.balance).toBeCloseTo(89.09, 2);
    }
    expect(sections.today?.balance).toBeCloseTo(89.09, 2);
    expect(sections.future).toHaveLength(0);
  });
});

describe("creditOwedAsOfDateFromTimeline", () => {
  const today = todayStr();

  it("returns owed as abs of negative signed balance through as-of date", () => {
    const timeline: TimelineRow[] = [
      {
        date: "2026-05-20",
        description: "Charge",
        account_id: 5,
        account_name: "Savor",
        category_id: null,
        category_name: null,
        amount: "-500",
        type: "OUTFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 1,
        running_balance: "-500",
      },
      {
        date: today,
        description: "Payment",
        account_id: 5,
        account_name: "Savor",
        category_id: null,
        category_name: null,
        amount: "200",
        type: "INFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 2,
        running_balance: "-300",
      },
    ];
    expect(creditOwedAsOfDateFromTimeline(timeline, 5, today, new Set())).toBeCloseTo(300, 2);
  });

  it("excludes edited payment and superseded planned duplicate on payment date", () => {
    const payDate = "2026-05-25";
    const planned: TimelineRow = {
      date: payDate,
      description: "Credit Card Pmt",
      account_id: 5,
      account_name: "Savor",
      category_id: 1,
      category_name: "Credit Card Payment",
      amount: "350",
      type: "INFLOW",
      status: "PLANNED",
      source: "rule",
      rule_id: 9,
      transaction_id: 20,
      running_balance: "-150",
    };
    const cleared: TimelineRow = {
      date: payDate,
      description: "Credit Card Pmt",
      account_id: 5,
      account_name: "Savor",
      category_id: 1,
      category_name: "Credit Card Payment",
      amount: "350",
      type: "INFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: 9,
      transaction_id: 21,
      running_balance: "-500",
    };
    const charge: TimelineRow = {
      date: "2026-05-24",
      description: "Store",
      account_id: 5,
      account_name: "Savor",
      category_id: null,
      category_name: null,
      amount: "-500",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 10,
      running_balance: "-500",
    };
    const timeline = [charge, planned, cleared];
    const exclude = new Set([21]);
    const signed = creditCardSignedBalanceAtDate(timeline, 5, payDate, exclude);
    expect(signed).toBeCloseTo(-500, 2);
    expect(creditOwedAsOfDateFromTimeline(timeline, 5, payDate, exclude)).toBeCloseTo(500, 2);
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

  it("routes future fallback transactions to forecast section", () => {
    const today = todayStr();
    const futureDate = addDaysToIsoDate(today, 30);
    const rows = buildLedgerRows(
      [
        {
          id: 1,
          date: today,
          payee: "Today charge",
          amount: "-10",
          direction: "OUTFLOW",
        } as never,
        {
          id: 2,
          date: futureDate,
          payee: "Save for Rent",
          amount: "680",
          direction: "INFLOW",
        } as never,
      ],
      0,
      "USD",
      false
    );
    const sections = splitLedgerSections(rows);
    expect(sections.past).toHaveLength(1);
    expect(sections.future).toHaveLength(1);
    expect(sections.past[0].type === "transaction" && sections.past[0].txn.date).toBe(today);
    expect(sections.future[0].type === "transaction" && sections.future[0].txn.date).toBe(futureDate);
  });

  it("anchors fallback opening balance to balance at today", () => {
    const today = todayStr();
    const txns = [
      { id: 1, date: today, payee: "Coffee", amount: "-10", direction: "OUTFLOW" } as never,
      { id: 2, date: today, payee: "Deposit", amount: "100", direction: "INFLOW" } as never,
    ];
    const opening = resolveFallbackLedgerOpening(txns, today, 500, false);
    const rows = buildLedgerRows(txns, opening, "USD", false);
    const todayRow = rows.find((r) => r.type === "today_balance");
    expect(todayRow?.balance).toBe(500);
  });
});

describe("timelineHasAccountRows", () => {
  it("returns false for empty or missing timeline", () => {
    expect(timelineHasAccountRows(undefined, 1)).toBe(false);
    expect(timelineHasAccountRows([], 1)).toBe(false);
  });

  it("returns true when rows exist for the account", () => {
    expect(
      timelineHasAccountRows(
        [{ account_id: 1, date: "2026-01-01", amount: "1", description: "x" } as TimelineRow],
        1
      )
    ).toBe(true);
    expect(
      timelineHasAccountRows(
        [{ account_id: 2, date: "2026-01-01", amount: "1", description: "x" } as TimelineRow],
        1
      )
    ).toBe(false);
  });
});
