import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TimelineCalendarDay, TimelineCalendarSummary, TimelineCalendarTransaction } from "@budget-app/shared";
import {
  calendarAccountRiskPresentation,
  calendarDateState,
  calendarDayPresentationStatus,
  calendarDayShowsAccountRisk,
  calendarGridTone,
  calendarDaySummaryShowsCanonicalEnding,
  nextCashShortfallBanner,
  noCashShortfallsCopy,
  resolveCalendarDayCellChrome,
} from "./calendarPresentation";
import { calendarEventStatusLabel } from "./calendarEventNavigation";
import {
  getCalendarEventDestination,
  prefersDirectEditFromCalendar,
} from "./calendarEventNavigation";
import { daySeverity, selectedDateAfterMonthChange } from "./calendarUtils";

const TODAY = "2026-08-28";
const YESTERDAY = "2026-08-27";
const TOMORROW = "2026-08-29";

function sampleDay(overrides: Partial<TimelineCalendarDay> = {}): TimelineCalendarDay {
  return {
    date: TODAY,
    income_total: "0",
    expense_total: "0",
    transfer_total: "0",
    net_total: "0",
    ending_balance: "1000",
    lowest_balance: "1000",
    presentation_status: "healthy",
    risk_level: "none",
    risk_reason: null,
    has_risk: false,
    heat_level: "neutral",
    transactions: [],
    ...overrides,
  };
}

describe("month selection regression", () => {
  it("clears selectedDate when navigating from August to September", () => {
    // selectedDate = 2026-08-28; user navigates to September
    expect(selectedDateAfterMonthChange("2026-08-28", 2026, 8)).toBeNull();
  });

  it("clears selectedDate even when the date belongs to the destination month", () => {
    // Preferred: month change always clears; goToday sets today explicitly.
    expect(selectedDateAfterMonthChange("2026-09-15", 2026, 8)).toBeNull();
  });

  it("CalendarScreen wires month nav through selectedDateAfterMonthChange", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CalendarScreen.tsx"),
      "utf8"
    );
    expect(source).toMatch(/selectedDateAfterMonthChange/);
    expect(source).toMatch(/goToMonth/);
  });

  it("CalendarDayCell uses expense > 0 for positive expense_total", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CalendarDayCell.tsx"),
      "utf8"
    );
    expect(source).toMatch(/expense > 0/);
    expect(source).not.toMatch(/expense < 0/);
  });
});

describe("resolveCalendarDayCellChrome", () => {
  const TODAY = "2026-08-28";

  it("marks today independently of selection using local todayIso", () => {
    const chrome = resolveCalendarDayCellChrome({
      dateIso: TODAY,
      isSelected: false,
      riskTone: "neutral",
      todayIso: TODAY,
    });
    expect(chrome.isToday).toBe(true);
    expect(chrome.isSelected).toBe(false);
    expect(chrome.background).toBe("today");
    expect(chrome.border).toBe("today");
    expect(chrome.borderWidth).toBe(2);
  });

  it("selected day uses outline without today fill", () => {
    const chrome = resolveCalendarDayCellChrome({
      dateIso: "2026-08-15",
      isSelected: true,
      riskTone: "neutral",
      todayIso: TODAY,
    });
    expect(chrome.isToday).toBe(false);
    expect(chrome.isSelected).toBe(true);
    expect(chrome.background).toBe("neutral");
    expect(chrome.border).toBe("selected");
    expect(chrome.borderWidth).toBe(2);
  });

  it("today + selected combines tint fill and selected outline", () => {
    const chrome = resolveCalendarDayCellChrome({
      dateIso: TODAY,
      isSelected: true,
      riskTone: "healthy",
      todayIso: TODAY,
    });
    expect(chrome.isToday).toBe(true);
    expect(chrome.isSelected).toBe(true);
    expect(chrome.background).toBe("today");
    expect(chrome.border).toBe("selected");
    expect(chrome.borderWidth).toBe(2);
  });

  it("future critical keeps risk fill; selected keeps blue outline", () => {
    const chrome = resolveCalendarDayCellChrome({
      dateIso: "2026-09-02",
      isSelected: true,
      riskTone: "critical",
      todayIso: TODAY,
    });
    expect(chrome.background).toBe("critical");
    expect(chrome.border).toBe("selected");
    expect(chrome.borderWidth).toBe(2);
  });

  it("future warning uses warning fill when not selected", () => {
    const chrome = resolveCalendarDayCellChrome({
      dateIso: "2026-09-01",
      isSelected: false,
      riskTone: "warning",
      todayIso: TODAY,
    });
    expect(chrome.background).toBe("warning");
    expect(chrome.border).toBe("warning");
    expect(chrome.borderWidth).toBe(1);
  });

  it("today never gets critical/warning fill even if backend flags risk", () => {
    const chrome = resolveCalendarDayCellChrome({
      dateIso: TODAY,
      isSelected: true,
      riskTone: "critical",
      todayIso: TODAY,
    });
    expect(chrome.isToday).toBe(true);
    expect(chrome.background).toBe("today");
    expect(chrome.border).toBe("selected");
    expect(chrome.borderWidth).toBe(2);
  });

  it("today unselected with risk tone still uses today tint, not red", () => {
    const chrome = resolveCalendarDayCellChrome({
      dateIso: TODAY,
      isSelected: false,
      riskTone: "critical",
      todayIso: TODAY,
    });
    expect(chrome.isToday).toBe(true);
    expect(chrome.background).toBe("today");
    expect(chrome.border).toBe("today");
    expect(chrome.borderWidth).toBe(2);
  });

  it("does not treat a non-today selected day as today", () => {
    const chrome = resolveCalendarDayCellChrome({
      dateIso: "2026-08-20",
      isSelected: true,
      riskTone: "neutral",
      todayIso: TODAY,
    });
    expect(chrome.isToday).toBe(false);
  });
});


describe("calendarDayPresentationStatus", () => {
  it("past days with negative historical balance are historical, not critical", () => {
    const day = sampleDay({
      date: YESTERDAY,
      is_forecast: false,
      presentation_status: "healthy",
      is_negative: true,
      has_risk: true,
      risk_level: "critical",
      heat_level: "dangerous",
      lowest_balance: "-2535.96",
      ending_balance: "-2535.96",
      expense_total: "219.14",
      net_total: "-219.14",
    });
    expect(calendarDayPresentationStatus(day, YESTERDAY, TODAY)).toBe("historical");
    expect(calendarGridTone("historical")).toBe("neutral");
  });

  it("future below-buffer day is warning", () => {
    const day = sampleDay({
      date: TOMORROW,
      is_forecast: true,
      presentation_status: "warning",
      has_risk: true,
      risk_level: "watch",
      heat_level: "tight",
      is_negative: false,
      below_buffer_amount: "50",
    });
    expect(calendarDayPresentationStatus(day, TOMORROW, TODAY)).toBe("future_warning");
    expect(calendarGridTone("future_warning")).toBe("warning");
  });

  it("future negative balance is critical", () => {
    const day = sampleDay({
      date: "2026-09-02",
      is_forecast: true,
      presentation_status: "critical",
      is_negative: true,
      risk_level: "critical",
      heat_level: "dangerous",
      lowest_projected_balance: "-378.80",
      lowest_projected_balance_account_name: "Main",
    });
    expect(calendarDayPresentationStatus(day, "2026-09-02", TODAY)).toBe("future_critical");
    expect(calendarGridTone("future_critical")).toBe("critical");
  });

  it("presentation_status wins over stale heat_level", () => {
    const day = sampleDay({
      date: TOMORROW,
      is_forecast: true,
      presentation_status: "healthy",
      // Stale competing flags must not turn the cell red/yellow.
      heat_level: "dangerous",
      is_negative: true,
      risk_level: "critical",
      has_risk: true,
    });
    expect(calendarDayPresentationStatus(day, TOMORROW, TODAY)).toBe("future_healthy");
  });

  it("no activity future day is healthy/neutral grid tone", () => {
    const day = sampleDay({ date: TOMORROW, is_forecast: true });
    expect(calendarDayPresentationStatus(day, TOMORROW, TODAY)).toBe("future_healthy");
    expect(calendarGridTone("future_healthy")).toBe("healthy");
  });

  it("negative daily net alone does not make a future day critical", () => {
    const day = sampleDay({
      date: TOMORROW,
      net_total: "-1100",
      expense_total: "1100",
      ending_balance: "3441",
      lowest_balance: "3441",
      presentation_status: "healthy",
      is_negative: false,
      has_risk: false,
      risk_level: "none",
      heat_level: "healthy",
      balance_scope: "household_cash",
    });
    expect(calendarDayPresentationStatus(day, TOMORROW, TODAY)).toBe("future_healthy");
    expect(calendarDayShowsAccountRisk(day, TOMORROW, TODAY)).toBe(false);
  });
});

describe("historical risk regression", () => {
  const dir = dirname(fileURLToPath(import.meta.url));

  it("does not render Historical risk in day summary source", () => {
    const summarySource = readFileSync(join(dir, "CalendarDaySummary.tsx"), "utf8");
    expect(summarySource).not.toMatch(/Historical risk/);
    expect(summarySource).not.toMatch(/ForecastWarningCard/);
  });

  it("does not render Historical risk anywhere in calendar feature", () => {
    const screenSource = readFileSync(join(dir, "CalendarScreen.tsx"), "utf8");
    expect(screenSource).not.toMatch(/Historical risk/);
    expect(screenSource).not.toMatch(/Next risk:/);
  });

  it("past Main low balance day does not show account risk section", () => {
    const day = sampleDay({
      date: YESTERDAY,
      is_forecast: false,
      is_negative: true,
      has_risk: true,
      risk_level: "critical",
      lowest_projected_balance: "-2535.96",
      lowest_projected_balance_account_name: "Main",
      risk_reason: "Main projected -2535.96",
    });
    expect(calendarDayShowsAccountRisk(day, YESTERDAY, TODAY)).toBe(false);
    expect(calendarAccountRiskPresentation(day, YESTERDAY, TODAY)).toBeNull();
  });
});

describe("household day summary fields", () => {
  it("shows canonical ending only for account scope, never household", () => {
    expect(calendarDaySummaryShowsCanonicalEnding("household_cash")).toBe(false);
    expect(calendarDaySummaryShowsCanonicalEnding(undefined)).toBe(false);
    expect(calendarDaySummaryShowsCanonicalEnding("account")).toBe(true);
  });

  it("does not derive household start as ending minus net", () => {
    const summarySource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CalendarDaySummary.tsx"),
      "utf8"
    );
    expect(summarySource).not.toMatch(/openingBalance/);
    expect(summarySource).not.toMatch(/ending_balance\) - parseCalendarAmount\(resolved\.net_total/);
    expect(summarySource).not.toMatch(/Household cash start/);
    expect(summarySource).not.toMatch(/Household cash end/);
    expect(summarySource).not.toMatch(/label="Net"/);
    expect(summarySource).toMatch(/label="Income"/);
    expect(summarySource).toMatch(/label="Expenses"/);
  });
});

describe("household vs account risk", () => {
  it("does not show account risk card for today even when heat is critical", () => {
    const day = sampleDay({
      date: TODAY,
      is_forecast: true,
      presentation_status: "critical",
      is_negative: true,
      has_risk: true,
      risk_level: "critical",
      heat_level: "dangerous",
      lowest_projected_balance: "-2439.36",
      lowest_projected_balance_account_name: "Main",
      lowest_projected_balance_date: TODAY,
    });
    expect(calendarDayShowsAccountRisk(day, TODAY, TODAY)).toBe(false);
    expect(calendarAccountRiskPresentation(day, TODAY, TODAY)).toBeNull();
    expect(calendarGridTone(calendarDayPresentationStatus(day, TODAY, TODAY))).toBe("healthy");
  });

  it("does not show First cash shortfall on a later day that inherited a carried marker", () => {
    const day = sampleDay({
      date: "2026-09-04",
      is_forecast: true,
      presentation_status: "critical",
      is_negative: true,
      has_risk: true,
      risk_level: "critical",
      heat_level: "dangerous",
      lowest_projected_balance: "-641.68",
      lowest_projected_balance_account_name: "Chase",
      lowest_projected_balance_date: "2026-09-02",
    });
    expect(calendarDayShowsAccountRisk(day, "2026-09-04", TODAY)).toBe(false);
    expect(calendarAccountRiskPresentation(day, "2026-09-04", TODAY)).toBeNull();
  });

  it("shows account risk only on the actual shortfall date", () => {
    const day = sampleDay({
      date: TOMORROW,
      balance_scope: "household_cash",
      ending_balance: "3441",
      presentation_status: "critical",
      is_negative: true,
      has_risk: true,
      risk_level: "critical",
      heat_level: "dangerous",
      lowest_projected_balance: "-378.80",
      lowest_projected_balance_account_name: "Main",
      lowest_projected_balance_account_id: 1,
      lowest_projected_balance_date: TOMORROW,
      lowest_projected_balance_transaction_id: 99,
      lowest_projected_balance_after_description: "Exeterfina Loan",
      transactions: [
        {
          id: 99,
          transaction_id: 99,
          account_id: 1,
          account_name: "Main",
          description: "Exeterfina Loan",
          amount: "-393.79",
          category: null,
          kind: "bill",
          source: "RULE",
          balance_after: "-378.80",
          is_transfer: false,
        },
      ],
    });
    const risk = calendarAccountRiskPresentation(day, TOMORROW, TODAY);
    expect(risk?.accountName).toBe("Main");
    expect(risk?.balanceAmount).toBe("-378.80");
    expect(risk?.detail).toMatch(/First cash shortfall/);
    expect(parseFloat(day.ending_balance)).toBeGreaterThan(0);
  });

  it("never pairs one account's balance with another account's after-description", () => {
    const day = sampleDay({
      date: TOMORROW,
      is_forecast: true,
      presentation_status: "critical",
      is_negative: true,
      has_risk: true,
      risk_level: "critical",
      heat_level: "dangerous",
      // Stale mixed fields (the bug): Chase balance + Main Electric description
      lowest_projected_balance: "-208.00",
      lowest_projected_balance_account_name: "Chase",
      lowest_projected_balance_account_id: 2,
      lowest_projected_balance_date: TOMORROW,
      lowest_projected_balance_transaction_id: 55,
      lowest_projected_balance_after_description: "Electric",
      affected_account_name: "Chase",
      transactions: [
        {
          id: 55,
          transaction_id: 55,
          account_id: 1,
          account_name: "Main",
          description: "Electric",
          amount: "-500.00",
          category: null,
          kind: "bill",
          source: "RULE",
          balance_after: "-88.86",
          is_transfer: false,
        },
      ],
    });
    // Focus txn id 55 is on Main, not Chase — do not show a mismatched Chase/-208 card.
    expect(calendarAccountRiskPresentation(day, TOMORROW, TODAY)).toBeNull();
  });

  it("uses the focus event canonical balance_after when account matches", () => {
    const day = sampleDay({
      date: TOMORROW,
      is_forecast: true,
      presentation_status: "critical",
      is_negative: true,
      has_risk: true,
      risk_level: "critical",
      heat_level: "dangerous",
      lowest_projected_balance: "-208.00",
      lowest_projected_balance_account_name: "Chase",
      lowest_projected_balance_account_id: 1,
      lowest_projected_balance_date: TOMORROW,
      lowest_projected_balance_transaction_id: 55,
      lowest_projected_balance_after_description: "Electric",
      transactions: [
        {
          id: 55,
          transaction_id: 55,
          account_id: 1,
          account_name: "Main",
          description: "Electric",
          amount: "-500.00",
          category: null,
          kind: "bill",
          source: "RULE",
          balance_after: "-88.86",
          is_transfer: false,
        },
      ],
    });
    // account_id on marker is 1 and event account_id is 1 → use event Bal
    const risk = calendarAccountRiskPresentation(day, TOMORROW, TODAY);
    expect(risk?.accountName).toBe("Main");
    expect(risk?.balanceAmount).toBe("-88.86");
    expect(risk?.detail).toBe("First cash shortfall · after Electric");
  });
});

describe("nextCashShortfallBanner", () => {
  const summary: TimelineCalendarSummary = {
    lowest_balance: "-522.54",
    lowest_balance_date: "2026-09-02",
    next_risk_date: "2026-09-02",
    best_balance: "5000",
    best_balance_date: "2026-08-28",
    total_income: "0",
    total_expenses: "0",
    total_net: "0",
    risky_accounts: [
      {
        account_id: 1,
        account_name: "Main",
        lowest_projected_balance: "-522.54",
        risk_date: "2026-09-02",
        risk_status: "critical",
      },
    ],
  };

  it("uses human-readable copy instead of ISO dates", () => {
    const banner = nextCashShortfallBanner(summary);
    expect(banner?.title).toBe("Next cash shortfall");
    expect(banner?.subtitle).toMatch(/Main · Sep 2 · -522\.54/);
    expect(banner?.subtitle).not.toMatch(/2026-09-02/);
  });

  it("returns null when no next risk date", () => {
    expect(nextCashShortfallBanner({ ...summary, next_risk_date: null })).toBeNull();
  });

  it("shows no-shortfalls copy helper", () => {
    expect(noCashShortfallsCopy(30)).toBe("No cash shortfalls in the next 30 days");
  });
});

function sampleTxn(overrides: Partial<TimelineCalendarTransaction> = {}): TimelineCalendarTransaction {
  return {
    id: 1,
    description: "Event",
    account_name: "Main",
    amount: "0",
    category: null,
    kind: "actual",
    source: "ACTUAL",
    balance_after: null,
    is_transfer: false,
    ...overrides,
  };
}

describe("calendar event navigation", () => {
  it("manual one-time transaction opens edit", () => {
    const txn = sampleTxn({
      id: 1,
      description: "Coffee",
      amount: "-5",
      source: "ONE_TIME",
      status: "CLEARED",
      transaction_id: 42,
    });
    expect(prefersDirectEditFromCalendar(txn)).toBe(true);
    expect(getCalendarEventDestination(txn)).toEqual({ type: "edit", transactionId: 42 });
  });

  it("rule-generated transaction opens detail", () => {
    const txn = sampleTxn({
      id: 2,
      description: "Paycheck",
      amount: "2000",
      kind: "projected",
      source: "RULE",
      status: "PLANNED",
      rule_id: 9,
      transaction_id: 99,
    });
    expect(prefersDirectEditFromCalendar(txn)).toBe(false);
    expect(getCalendarEventDestination(txn)).toEqual({ type: "detail", transactionId: 99 });
  });

  it("imported transaction opens detail", () => {
    const txn = sampleTxn({
      id: 3,
      description: "Amazon",
      amount: "-50",
      source: "PLAID",
      status: "CLEARED",
      transaction_id: 55,
    });
    expect(getCalendarEventDestination(txn)).toEqual({ type: "detail", transactionId: 55 });
  });

  it("transfer opens detail", () => {
    const txn = sampleTxn({
      id: 4,
      description: "Transfer",
      amount: "-100",
      status: "CLEARED",
      transaction_id: 77,
      is_transfer: true,
    });
    expect(getCalendarEventDestination(txn)).toEqual({ type: "detail", transactionId: 77 });
  });
});

describe("calendar event status labels", () => {
  it("does not show Forecast for historical posted transactions", () => {
    const txn = sampleTxn({
      description: "Chewy",
      amount: "-119.14",
      category: "Pets",
      source: "PLAID",
      status: "CLEARED",
      transaction_id: 10,
    });
    expect(calendarEventStatusLabel(txn, "past")).toBe("Posted");
  });

  it("shows Forecast for future planned events", () => {
    const txn = sampleTxn({
      description: "Rent",
      amount: "-1500",
      category: "Housing",
      kind: "projected",
      source: "RULE",
      status: "PLANNED",
      rule_id: 3,
    });
    expect(calendarEventStatusLabel(txn, "future")).toBe("Forecast");
  });

  it("shows Pending for pending events", () => {
    const txn = sampleTxn({
      description: "Check",
      amount: "-50",
      status: "PENDING",
      transaction_id: 12,
    });
    expect(calendarEventStatusLabel(txn, "today")).toBe("Pending");
  });
});

describe("daySeverity legacy compat", () => {
  it("past negative balance is not critical in legacy daySeverity", () => {
    expect(
      daySeverity(
        sampleDay({
          date: YESTERDAY,
          is_negative: true,
          has_risk: true,
          lowest_balance: "-50",
        }),
        YESTERDAY
      )
    ).toBe("neutral");
  });

  it("future negative balance remains critical in legacy daySeverity", () => {
    expect(
      daySeverity(
        sampleDay({
          date: TOMORROW,
          presentation_status: "critical",
          is_negative: true,
          lowest_balance: "-50",
        }),
        TOMORROW
      )
    ).toBe("critical");
  });
});

describe("shortfall banner navigation wiring", () => {
  it("CalendarNextRiskBanner navigates to transactions forecast risk", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CalendarNextRiskBanner.tsx"),
      "utf8"
    );
    expect(source).toMatch(/transactionsForForecastRiskPath/);
    expect(source).not.toMatch(/setSelectedDate/);
  });

  it("CalendarScreen wires account risk tap to transactions", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CalendarScreen.tsx"),
      "utf8"
    );
    expect(source).toMatch(/transactionsForForecastRiskPath/);
    expect(source).toMatch(/getCalendarEventDestination/);
  });
});

describe("month grid styling source", () => {
  it("CalendarDayCell uses presentation status and explicit today chrome", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CalendarDayCell.tsx"),
      "utf8"
    );
    expect(source).toMatch(/calendarDayPresentationStatus/);
    expect(source).toMatch(/resolveCalendarDayCellChrome/);
    expect(source).toMatch(/todayStr\(\)/);
    expect(source).not.toMatch(/daySeverity/);
  });

  it("CalendarEventRow does not show per-event risk_flag triangles", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "CalendarEventRow.tsx"),
      "utf8"
    );
    expect(source).not.toMatch(/risk_flag/);
    expect(source).not.toMatch(/exclamation-triangle/);
  });
});
