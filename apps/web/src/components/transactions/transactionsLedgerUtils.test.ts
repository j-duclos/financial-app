import { describe, it, expect } from "vitest";
import {
  buildLedgerRows,
  buildLedgerRowsFromTimeline,
  hideReconciledOpeningBalance,
  creditBalanceColorClass,
  ledgerOpeningBalance,
  accountLedgerDisplayBalance,
  resolveLedgerOpening,
  isForecastTimelineRow,
  isPastTimelineRow,
  isProjectedInterestRow,
  isSupersededPlannedTimelineRow,
  shouldHighlightUnmatchedScheduledRow,
  creditOwedAsOfDateFromTimeline,
  creditCardSignedBalanceAtDate,
  creditSignedOpeningBalance,
  splitLedgerSections,
  lowestProjectedFromLedgerFuture,
  formatDateDisplay,
  todayStr,
  timelineRangeForFilter,
  upcomingTimelineRange,
  UPCOMING_FORECAST_DAYS,
  pastTransactionsRange,
  ledgerPastTransactionStart,
  filterPastTransactionsAfterReconcileClose,
  buildLedgerRowsFromPastAndUpcomingTimeline,
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

describe("upcomingTimelineRange", () => {
  it("spans today through 90 days forward", () => {
    const today = todayStr();
    const { start, end } = upcomingTimelineRange(today);
    expect(start).toBe(today);
    expect(end).toBe(addDaysToIsoDate(today, UPCOMING_FORECAST_DAYS));
  });
});

describe("ledgerPastTransactionStart", () => {
  it("starts after closed reconcile period when statement was reconciled", () => {
    const periodEnd = "2026-06-02";
    const start = ledgerPastTransactionStart("3m", true, {
      min_start_date: "2026-05-05",
      last_reconcile_period_end: periodEnd,
    });
    expect(start).toBe("2026-06-03");
  });

  it("includes same-day post-reconcile rows on period end", () => {
    const periodEnd = "2026-06-02";
    const start = ledgerPastTransactionStart("3m", true, {
      min_start_date: periodEnd,
      last_reconcile_period_end: periodEnd,
    });
    expect(start).toBe(periodEnd);
  });
});

describe("filterPastTransactionsAfterReconcileClose", () => {
  it("does not re-walk statement rows already in opening bank balance", () => {
    const periodEnd = "2026-06-02";
    const txns = [
      { id: 1, date: "2026-05-05", payee: "AT&T", amount: "-257.08" },
      { id: 2, date: "2026-06-02", payee: "INTEREST", amount: "-19.87" },
      { id: 3, date: "2026-06-04", payee: "Cursor", amount: "-65.52" },
    ] as never[];
    const kept = filterPastTransactionsAfterReconcileClose(txns, periodEnd, "2026-05-05");
    expect(kept.map((t) => t.id)).toEqual([3]);
  });
});

describe("pastTransactionsRange", () => {
  it("ends at today for history queries", () => {
    const today = todayStr();
    const { end } = pastTransactionsRange("3m");
    expect(end).toBe(today);
  });
});

describe("buildLedgerRowsFromPastAndUpcomingTimeline", () => {
  it("combines posted past rows with upcoming projection rows", () => {
    const today = todayStr();
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline(
      [
        {
          id: 1,
          date: today,
          payee: "Coffee",
          amount: "-5.00",
          source: "PLAID",
        } as never,
      ],
      [
        {
          date: addDaysToIsoDate(today, 7),
          description: "Rent",
          account_id: 1,
          amount: "-1200.00",
          type: "OUTFLOW",
          status: "planned",
          source: "rule",
          rule_id: 9,
          transaction_id: null,
          running_balance: "500",
        } as TimelineRow,
      ],
      today,
      1000,
      false
    );
    const future = splitLedgerSections(rows).future;
    expect(future.length).toBe(1);
    expect(future[0].type).toBe("recurring");
  });

  it("continues upcoming balances from the last past row (no API balance jump)", () => {
    const today = todayStr();
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline(
      [
        {
          id: 1,
          date: today,
          payee: "Coffee",
          amount: "-5.00",
          source: "PLAID",
        } as never,
      ],
      [
        {
          date: addDaysToIsoDate(today, 1),
          description: "Lowes",
          account_id: 1,
          amount: "-110.01",
          type: "OUTFLOW",
          status: "planned",
          source: "rule",
          rule_id: 9,
          transaction_id: 50,
          running_balance: "632.52",
        } as TimelineRow,
      ],
      today,
      1000,
      false,
      { pastOpeningOverride: 1005 }
    );
    const sections = splitLedgerSections(rows);
    const lastPast = sections.past[sections.past.length - 1];
    const firstFuture = sections.future[0];
    expect(lastPast?.balance).toBeCloseTo(1000, 2);
    expect(firstFuture?.balance).toBeCloseTo(1000 - 110.01, 2);
  });

  it("does not duplicate due planned rows in past and pending", () => {
    const today = todayStr();
    const plannedChewy = {
      id: 10,
      date: today,
      payee: "Chewy",
      amount: "-79.46",
      status: "PLANNED",
      source: "RULE",
      rule_id: 34,
    } as never;
    const clearedCoffee = {
      id: 11,
      date: today,
      payee: "Coffee Shop",
      amount: "-5.00",
      status: "CLEARED",
      source: "PLAID",
    } as never;
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline(
      [plannedChewy, clearedCoffee],
      [
        {
          date: today,
          description: "Chewy",
          account_id: 1,
          amount: "-79.46",
          type: "OUTFLOW",
          status: "PLANNED",
          source: "actual",
          txn_source: "rule",
          rule_id: 34,
          transaction_id: 10,
          running_balance: "900",
        } as TimelineRow,
      ],
      today,
      1000,
      false
    );
    const sections = splitLedgerSections(rows);
    expect(sections.past).toHaveLength(1);
    if (sections.past[0].type === "transaction") {
      expect(sections.past[0].txn.payee).toBe("Coffee Shop");
    }
    expect(sections.pending).toHaveLength(1);
    if (sections.pending[0].type === "transaction_from_timeline") {
      expect(sections.pending[0].row.description).toBe("Chewy");
    }
    expect(sections.pending[0].balance).toBeCloseTo(995 - 79.46, 2);
  });

  it("uses credit-card balance math for past transactions (charges increase debt)", () => {
    const today = todayStr();
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline(
      [
        {
          id: 1,
          date: "2026-06-25",
          payee: "STORE 3068 MARICOPA AZ",
          amount: "-142.18",
          status: "CLEARED",
          source: "PLAID",
        } as never,
      ],
      [
        {
          date: addDaysToIsoDate(today, 1),
          description: "Lowes (Lowe's)",
          account_id: 40,
          amount: "110.01",
          type: "INFLOW",
          status: "PLANNED",
          source: "actual",
          txn_source: "rule",
          rule_id: 5,
          transaction_id: 2,
          running_balance: "142.18",
        } as TimelineRow,
      ],
      today,
      110.01,
      true
    );
    const sections = splitLedgerSections(rows);
    expect(sections.start?.balance).toBeCloseTo(110.01, 2);
    expect(sections.past[0].balance).toBeCloseTo(252.19, 2);
    expect(sections.future[0].balance).toBeCloseTo(142.18, 2);
  });

  it("does not double-count unreconciled rows inside a closed reconcile period", () => {
    const periodEnd = "2026-06-02";
    const rows = buildLedgerRowsFromPastAndUpcomingTimeline(
      [
        { id: 1, date: "2026-05-05", payee: "AT&T", amount: "-257.08", status: "CLEARED" } as never,
        { id: 2, date: "2026-06-02", payee: "INTEREST", amount: "-19.87", status: "CLEARED" } as never,
        { id: 3, date: "2026-06-04", payee: "Cursor", amount: "-65.52", status: "CLEARED" } as never,
      ],
      [],
      "2026-06-27",
      0,
      true,
      {
        pastOpeningOverride: 759.31,
        lastReconcilePeriodEnd: periodEnd,
        reconcileFloor: "2026-05-05",
      }
    );
    const sections = splitLedgerSections(rows);
    expect(sections.past).toHaveLength(1);
    expect(sections.past[0].balance).toBeCloseTo(824.83, 2);
  });

  it("hide-reconciled credit opening normalizes signed reconcile balance", () => {
    expect(hideReconciledOpeningBalance(-1301.96, true)).toBeCloseTo(1301.96, 2);
    const rows = buildLedgerRowsFromTimeline(
      [
        {
          date: "2026-06-11",
          description: "CAPITAL ONE ONLINE PYMT",
          amount: "200.00",
          running_balance: "-1101.96",
          account_id: 6,
          status: "CLEARED",
        } as never,
        {
          date: "2026-06-12",
          description: "Cox",
          amount: "-70.00",
          running_balance: "-1171.96",
          account_id: 6,
          status: "CLEARED",
        } as never,
      ],
      "2026-06-30",
      0,
      true,
      -1301.96
    );
    const sections = splitLedgerSections(rows);
    expect(sections.start?.balance).toBeCloseTo(1301.96, 2);
    expect(sections.past[0].balance).toBeCloseTo(1101.96, 2);
    expect(sections.past[1].balance).toBeCloseTo(1171.96, 2);
  });

  it("hide-reconciled walks sequentially from opening override, not absolute server balances", () => {
    const rows = buildLedgerRowsFromTimeline(
      [
        {
          date: "2026-06-26",
          description: "Chewy",
          amount: "-29.01",
          running_balance: "2205.84",
          account_id: 1,
          status: "CLEARED",
        } as never,
        {
          date: "2026-06-28",
          description: "Slim Chickens",
          amount: "-33.84",
          running_balance: "2174.01",
          account_id: 1,
          status: "CLEARED",
        } as never,
        {
          date: "2026-06-29",
          description: "Fry's Food and Drug",
          amount: "-17.91",
          running_balance: "1327.31",
          account_id: 1,
          status: "CLEARED",
        } as never,
      ],
      "2026-06-30",
      0,
      false,
      2234.85
    );
    const sections = splitLedgerSections(rows);
    expect(sections.start?.balance).toBeCloseTo(2234.85, 2);
    expect(sections.past[0].balance).toBeCloseTo(2205.84, 2);
    expect(sections.past[1].balance).toBeCloseTo(2172, 1);
    expect(sections.past[2].balance).toBeCloseTo(2154.09, 1);
  });
});

describe("projectionTimelineRangeForAsOf", () => {
  it("uses a short history window and no long future horizon", () => {
    const today = todayStr();
    const { start, end, as_of } = projectionTimelineRangeForAsOf("2020-06-15");
    expect(as_of).toBe(today);
    expect(start).toBe(addDaysToIsoDate(as_of, -120));
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
  it("derives opening from first timeline row for credit cards", () => {
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

  it("buildLedgerRowsFromTimeline uses configured starting balance for bank accounts", () => {
    const timeline: TimelineRow[] = [
      {
        date: "2026-03-16",
        description: "Chewy",
        account_id: 1,
        account_name: "Chase",
        category_id: null,
        category_name: null,
        amount: "-125.53",
        type: "OUTFLOW",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 1,
        running_balance: "6890.39",
      },
    ];
    const rows = buildLedgerRowsFromTimeline(timeline, todayStr(), 1805.3, false);
    expect(rows.find((r) => r.type === "starting_balance")?.balance).toBe(1805.3);
    const pastTxn = rows.find((r) => r.type === "transaction_from_timeline");
    expect(pastTxn?.balance).toBeCloseTo(1805.3 - 125.53, 2);
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

  it("puts today planned rule rows in pending expected, not past or forecast", () => {
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
    expect(sections.past).toHaveLength(1);
    expect(sections.pending).toHaveLength(1);
    expect(sections.future).toHaveLength(0);
    if (sections.pending[0].type === "transaction_from_timeline") {
      expect(sections.pending[0].row.description).toBe("Geico");
    }
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

describe("creditSignedOpeningBalance", () => {
  it("negates positive opening debt for signed credit balance", () => {
    expect(creditSignedOpeningBalance("110.01")).toBeCloseTo(-110.01, 2);
    expect(creditSignedOpeningBalance("0")).toBe(0);
    expect(creditSignedOpeningBalance(null)).toBe(0);
  });
});

describe("creditOwedAsOfDateFromTimeline", () => {
  const today = todayStr();

  it("uses opening balance when card timeline has no rows", () => {
    expect(
      creditOwedAsOfDateFromTimeline([], 40, "2026-06-26", new Set(), -110.01)
    ).toBeCloseTo(110.01, 2);
  });

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
      906.52,
      "USD",
      false
    );
    const sections = splitLedgerSections(rows);
    expect(sections.start?.type).toBe("starting_balance");
    expect(sections.start?.balance).toBe(906.52);
    expect(sections.past).toHaveLength(1);
    expect(sections.future).toHaveLength(1);
  });

  it("uses account starting balance and API balance for today row in fallback", () => {
    const today = todayStr();
    const rows = buildLedgerRows(
      [{ id: 1, date: today, payee: "Coffee", amount: "-10", direction: "OUTFLOW" } as never],
      1805.3,
      "USD",
      false,
      1923.99
    );
    expect(rows.find((r) => r.type === "starting_balance")?.balance).toBe(1805.3);
    expect(rows.find((r) => r.type === "today_balance")?.balance).toBe(1923.99);
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

describe("lowestProjectedFromLedgerFuture", () => {
  it("returns the minimum running balance and its date from forecast rows", () => {
    const future = [
      { type: "recurring" as const, row: { date: "2026-07-02" } as TimelineRow, balance: 129.35 },
      { type: "recurring" as const, row: { date: "2026-07-03" } as TimelineRow, balance: 49.89 },
      { type: "recurring" as const, row: { date: "2026-07-10" } as TimelineRow, balance: 200 },
    ];
    expect(lowestProjectedFromLedgerFuture(future)).toEqual({
      balance: 49.89,
      date: "2026-07-03",
    });
  });
});

describe("shouldHighlightUnmatchedScheduledRow", () => {
  const plannedChewy: TimelineRow = {
    date: "2026-06-14",
    description: "Chewy",
    account_id: 1,
    account_name: "Chase",
    category_id: 1,
    category_name: "Dog Food",
    amount: "-79.46",
    type: "OUTFLOW",
    status: "PLANNED",
    source: "rule",
    rule_id: 10,
    transaction_id: null,
    running_balance: "3228.53",
  };

  const plannedAtt: TimelineRow = {
    ...plannedChewy,
    date: "2026-06-15",
    description: "ATT",
    amount: "-250.00",
    rule_id: 11,
  };

  const importedPypl: TimelineRow = {
    date: "2026-06-15",
    description: "PYPL PAYMTHLY",
    account_id: 1,
    account_name: "Chase",
    category_id: null,
    category_name: null,
    amount: "-36.88",
    type: "OUTFLOW",
    status: "CLEARED",
    source: "actual",
    rule_id: null,
    transaction_id: 99,
    txn_source: "plaid",
    running_balance: "3000",
  };

  it("highlights payroll when bank posts one day before the automation date", () => {
    const payrollDesc = "2930 JOHN GALT S PAYROLL PPD ID: 14409866";
    const plannedPayroll: TimelineRow = {
      date: "2026-06-19",
      description: payrollDesc,
      account_id: 1,
      account_name: "Chase",
      category_id: 2,
      category_name: "Paycheck / Salary",
      amount: "1835.52",
      type: "INFLOW",
      status: "PLANNED",
      source: "actual",
      txn_source: "rule",
      rule_id: 5,
      transaction_id: 200,
      running_balance: "3976.70",
    };
    const importedPayroll: TimelineRow = {
      date: "2026-06-18",
      description: payrollDesc,
      account_id: 1,
      account_name: "Chase",
      category_id: 2,
      category_name: "Paycheck / Salary",
      amount: "1835.52",
      type: "INFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 201,
      txn_source: "plaid",
      running_balance: "2361.21",
    };
    const timeline = [importedPayroll, plannedPayroll];
    expect(isSupersededPlannedTimelineRow(plannedPayroll, timeline)).toBe(false);
    expect(shouldHighlightUnmatchedScheduledRow(plannedPayroll, timeline)).toBe(true);
  });

  it("highlights when matching import exists within date window", () => {
    const importedChewy: TimelineRow = {
      date: "2026-06-14",
      description: "CHEWY INC",
      account_id: 1,
      account_name: "Chase",
      category_id: null,
      category_name: null,
      amount: "-79.46",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 98,
      txn_source: "plaid",
      running_balance: "3100",
    };
    const timeline = [plannedChewy, importedChewy];
    expect(shouldHighlightUnmatchedScheduledRow(plannedChewy, timeline)).toBe(true);
  });

  it("does not highlight when a same-day import superseded the planned row", () => {
    const matched: TimelineRow = {
      date: "2026-06-15",
      description: "ATT",
      account_id: 1,
      account_name: "Chase",
      category_id: null,
      category_name: null,
      amount: "-250.00",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: 11,
      transaction_id: 100,
      running_balance: "2900",
    };
    const timeline = [plannedAtt, matched];
    expect(shouldHighlightUnmatchedScheduledRow(plannedAtt, timeline)).toBe(false);
  });

  it("highlights materialized PLANNED rule rows when a matching import exists", () => {
    const materialized: TimelineRow = {
      date: "2026-06-14",
      description: "Chewy",
      account_id: 1,
      account_name: "Chase",
      category_id: 1,
      category_name: "Dog Food",
      amount: "-79.46",
      type: "OUTFLOW",
      status: "PLANNED",
      source: "actual",
      txn_source: "rule",
      rule_id: 34,
      transaction_id: 900,
      running_balance: "3228.53",
    };
    const importedChewy: TimelineRow = {
      date: "2026-06-14",
      description: "CHEWY INC",
      account_id: 1,
      account_name: "Chase",
      category_id: null,
      category_name: null,
      amount: "-79.46",
      type: "OUTFLOW",
      status: "CLEARED",
      source: "actual",
      rule_id: null,
      transaction_id: 901,
      txn_source: "plaid",
      running_balance: "3200",
    };
    const timeline = [materialized, importedChewy];
    expect(shouldHighlightUnmatchedScheduledRow(materialized, timeline)).toBe(true);
  });

  it("does not highlight when a matched sibling rule row already absorbed the import", () => {
    const payrollDesc = "2930 JOHN GALT S PAYROLL PPD ID: 14409866";
    const matchedSibling: TimelineRow = {
      date: "2026-06-18",
      description: payrollDesc,
      account_id: 1,
      account_name: "Chase",
      category_id: 2,
      category_name: "Paycheck / Salary",
      amount: "1835.52",
      type: "INFLOW",
      status: "PLANNED",
      source: "actual",
      txn_source: "rule",
      rule_id: 46,
      import_match_status: "matched",
      transaction_id: 5936,
      running_balance: "2381.21",
    };
    const shadowScheduled: TimelineRow = {
      date: "2026-06-19",
      description: payrollDesc,
      account_id: 1,
      account_name: "Chase",
      category_id: 2,
      category_name: "Paycheck / Salary",
      amount: "1835.52",
      type: "INFLOW",
      status: "PLANNED",
      source: "actual",
      txn_source: "rule",
      rule_id: 46,
      transaction_id: 6444,
      running_balance: "3176.24",
    };
    const timeline = [matchedSibling, shadowScheduled];
    expect(shouldHighlightUnmatchedScheduledRow(shadowScheduled, timeline)).toBe(false);
  });

  it("does not highlight when the scheduled row is already matched to a bank import", () => {
    const matched: TimelineRow = {
      date: "2026-06-15",
      description: "POS DEBIT HENRY MEDS",
      account_id: 1,
      account_name: "Chase",
      category_id: null,
      category_name: null,
      amount: "-99.00",
      type: "OUTFLOW",
      status: "PLANNED",
      source: "actual",
      txn_source: "rule",
      import_match_status: "matched",
      rule_id: 42,
      transaction_id: 6119,
      running_balance: "3000",
    };
    const timeline = [matched, importedPypl];
    expect(shouldHighlightUnmatchedScheduledRow(matched, timeline)).toBe(false);
  });

  it("does not highlight transfer leg already confirmed by bank import", () => {
    const matchedTransferLeg: TimelineRow = {
      date: "2026-03-20",
      description: "Credit Card Payment",
      account_id: 2,
      account_name: "Savor",
      category_id: null,
      category_name: null,
      amount: "1100.00",
      type: "INFLOW",
      status: "PLANNED",
      source: "actual",
      transfer_group_id: 99,
      plaid_transaction_id: "pl-savor-in",
      import_match_status: "matched",
      transaction_id: 7001,
      running_balance: "0",
    };
    expect(shouldHighlightUnmatchedScheduledRow(matchedTransferLeg, [matchedTransferLeg])).toBe(false);
  });
});
