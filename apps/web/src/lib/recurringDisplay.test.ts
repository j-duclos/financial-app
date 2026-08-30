import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BillChecklistItem, RecurringRule } from "@budget-app/shared";
import {
  buildRecurringListItems,
  cadenceLabel,
  computeRecurringSummary,
  deriveRecurringPaymentStatus,
  formatDayOfMonthOrdinal,
  getRecurringGroup,
  groupRecurringItemsByDay,
  pickChecklistOccurrenceForRule,
  resolveRecurringLastPaidDate,
  resolveRecurringNextOccurrence,
  recurringPaymentRowAccentClass,
  recurringPaymentStatusBadgeClass,
  ruleMonthlyExpenseAmount,
  splitRecurringBillPayments,
  type RecurringBillPaymentRow,
} from "./recurringDisplay";

function baseRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 1,
    household: 1,
    name: "Netflix",
    account: { id: 1, name: "Checking" } as RecurringRule["account"],
    transfer_to_account: null,
    category: { id: 1, name: "Streaming" } as RecurringRule["category"],
    direction: "EXPENSE",
    amount: "15.99",
    currency: "USD",
    frequency: "MONTHLY_DAY",
    interval: 1,
    day_of_week: null,
    day_of_month: 17,
    nth_week: null,
    start_date: "2024-01-01",
    end_date: null,
    active: true,
    paused_at: null,
    notes: null,
    is_bill: true,
    next_occurrence_date: "2026-05-17",
    estimated_monthly_amount: "-15.99",
    payment_status: "scheduled",
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function baseOccurrence(
  overrides: Partial<Parameters<typeof deriveRecurringPaymentStatus>[1]> = {}
) {
  return {
    id: 10,
    name: "Netflix",
    account: { id: 1, name: "Checking" },
    due_date: "2026-05-17",
    amount: "15.99",
    category: null,
    source_type: "rule" as const,
    transaction_id: null,
    rule_id: 1,
    status: "projected" as const,
    paid_date: null,
    matched_transaction_id: null,
    is_overdue: false,
    days_until_due: 10,
    skipped: false,
    notes: "",
    ...overrides,
  };
}

const displaySource = readFileSync(join(__dirname, "recurringDisplay.ts"), "utf8");
const recurringPageSource = readFileSync(join(__dirname, "../pages/Recurring.tsx"), "utf8");
const rulesPageSource = readFileSync(join(__dirname, "../pages/Rules.tsx"), "utf8");

describe("recurringDisplay — backend-owned occurrence state", () => {
  it("production display module does not import getNextRuleRunDate", () => {
    expect(displaySource).not.toMatch(/getNextRuleRunDate/);
    expect(displaySource).not.toMatch(/from ["'].*ruleOccurrences/);
  });

  it("does not keep a production fixed due-soon day threshold", () => {
    expect(displaySource).not.toMatch(/DUE_SOON_DAYS/);
    expect(displaySource).not.toMatch(/52\s*\/\s*12/);
    expect(displaySource).not.toMatch(/26\s*\/\s*12/);
  });

  it("uses canonical backend next_occurrence_date", () => {
    const rule = baseRule({ next_occurrence_date: "2026-06-01" });
    expect(resolveRecurringNextOccurrence(rule, null, "2026-05-28")).toBe("2026-06-01");
  });

  it("does not advance settled occurrences client-side", () => {
    const rule = baseRule({
      next_occurrence_date: "2026-06-01",
      payment_status: "due_soon",
    });
    const paidMay = baseOccurrence({
      due_date: "2026-05-01",
      status: "paid",
      paid_date: "2026-05-01",
      transaction_id: 1,
      matched_transaction_id: 1,
    });
    expect(resolveRecurringNextOccurrence(rule, paidMay, "2026-05-28")).toBe("2026-06-01");
  });

  it("prefers backend payment_status over checklist arithmetic", () => {
    expect(
      deriveRecurringPaymentStatus(
        baseRule({ payment_status: "missed" }),
        baseOccurrence({ due_date: "2026-05-20", status: "projected" }),
        "2026-05-11"
      )
    ).toBe("missed");
  });

  it("maps checklist due_soon label without client day threshold", () => {
    expect(
      deriveRecurringPaymentStatus(
        baseRule({ payment_status: undefined }),
        baseOccurrence({ status: "due_soon" }),
        "2026-05-11"
      )
    ).toBe("due_soon");
  });

  it("marks skipped / paid from checklist labels when payment_status absent", () => {
    expect(
      deriveRecurringPaymentStatus(
        baseRule({ payment_status: undefined }),
        baseOccurrence({ skipped: true, status: "skipped" }),
        "2026-05-11"
      )
    ).toBe("skipped");
    expect(
      deriveRecurringPaymentStatus(
        baseRule({ payment_status: undefined }),
        baseOccurrence({
          status: "paid",
          paid_date: "2026-05-04",
          transaction_id: 99,
          matched_transaction_id: 99,
        }),
        "2026-05-04"
      )
    ).toBe("paid");
  });

  it("uses backend estimated_monthly_amount for monthly obligation", () => {
    expect(ruleMonthlyExpenseAmount(baseRule({ estimated_monthly_amount: "-42.50" }))).toBe(42.5);
    expect(ruleMonthlyExpenseAmount(baseRule({ direction: "INCOME", estimated_monthly_amount: "100" }))).toBe(
      0
    );
  });

  it("prefers backend summary for monthly totals", () => {
    const items = buildRecurringListItems([baseRule()], []);
    const summary = computeRecurringSummary(items, {
      active_rule_count: 3,
      monthly_recurring_obligations: "120.00",
      upcoming_count: 2,
      missed_count: 1,
      due_soon_count: 0,
      due_soon_days: 5,
    });
    expect(summary.activeRules).toBe(3);
    expect(summary.monthlyRecurringTotal).toBe(120);
    expect(summary.missedCount).toBe(1);
  });

  it("groups streaming as subscriptions", () => {
    expect(getRecurringGroup(baseRule())).toBe("subscriptions");
  });

  it("groups transfers via system_code / direction, not display names alone", () => {
    expect(
      getRecurringGroup(
        baseRule({
          direction: "TRANSFER",
          category: {
            id: 9,
            name: "Custom Label",
            system_code: "BANK_TRANSFER",
            allows_transfer_destination: true,
          } as RecurringRule["category"],
        })
      )
    ).toBe("transfers");
  });

  it("labels monthly cadence with ordinal day", () => {
    expect(cadenceLabel(baseRule())).toBe("Monthly · 17th");
  });

  it("formats day-of-month ordinals", () => {
    expect(formatDayOfMonthOrdinal(4)).toBe("4th");
    expect(formatDayOfMonthOrdinal(21)).toBe("21st");
  });

  it("uses red accent for missed rows", () => {
    expect(recurringPaymentRowAccentClass("missed")).toContain("red");
    expect(recurringPaymentStatusBadgeClass("missed")).toContain("red");
    expect(recurringPaymentRowAccentClass("paid")).toContain("emerald");
    expect(recurringPaymentRowAccentClass("due_soon")).toContain("amber");
  });

  it("finds last paid date from checklist history when current row is unpaid", () => {
    const items: BillChecklistItem[] = [
      {
        id: 1,
        name: "Netflix",
        account: { id: 1, name: "Checking" },
        due_date: "2026-05-17",
        amount: "19",
        category: null,
        source_type: "rule",
        transaction_id: 9,
        rule_id: 10,
        status: "paid",
        paid_date: "2026-05-17",
        matched_transaction_id: 9,
        is_overdue: false,
        days_until_due: -11,
        skipped: false,
        notes: "",
      },
      {
        id: 2,
        name: "Netflix",
        account: { id: 1, name: "Checking" },
        due_date: "2026-06-17",
        amount: "19",
        category: null,
        source_type: "rule",
        transaction_id: null,
        rule_id: 10,
        status: "projected",
        paid_date: null,
        matched_transaction_id: null,
        is_overdue: false,
        days_until_due: 20,
        skipped: false,
        notes: "",
      },
    ];
    expect(resolveRecurringLastPaidDate(items, 10, items[1]!)).toBe("2026-05-17");
  });

  it("groups list items by day of month", () => {
    const items = buildRecurringListItems(
      [
        baseRule({ id: 1, name: "Hulu", day_of_month: 4, next_occurrence_date: "2026-05-04" }),
        baseRule({ id: 2, name: "Netflix", day_of_month: 17, next_occurrence_date: "2026-05-17" }),
      ],
      []
    );
    const grouped = groupRecurringItemsByDay(items);
    expect(grouped.map((g) => g.day)).toEqual([4, 17]);
    expect(grouped[0]?.label).toBe("4th");
  });

  it("prefers unpaid past-due occurrence for matching", () => {
    const items: BillChecklistItem[] = [
      {
        id: 1,
        name: "Netflix",
        account: { id: 1, name: "Checking" },
        due_date: "2026-06-17",
        amount: "19",
        category: null,
        source_type: "rule",
        transaction_id: null,
        rule_id: 10,
        status: "projected",
        paid_date: null,
        matched_transaction_id: null,
        is_overdue: false,
        days_until_due: 20,
        skipped: false,
        notes: "",
      },
      {
        id: 2,
        name: "Netflix",
        account: { id: 1, name: "Checking" },
        due_date: "2026-05-17",
        amount: "19",
        category: null,
        source_type: "rule",
        transaction_id: null,
        rule_id: 10,
        status: "missed",
        paid_date: null,
        matched_transaction_id: null,
        is_overdue: true,
        days_until_due: -11,
        skipped: false,
        notes: "",
      },
    ];
    const picked = pickChecklistOccurrenceForRule(items, 10, "2026-05-28");
    expect(picked?.id).toBe(2);
  });

  it("splits rule payments into ascending history and forecast", () => {
    const payments: RecurringBillPaymentRow[] = [
      { id: 3, date: "2028-05-17", amount: "19.09", payee: "Netflix" },
      { id: 1, date: "2027-12-17", amount: "19.09", payee: "Netflix" },
      { id: 2, date: "2026-04-01", amount: "19.09", payee: "Netflix" },
    ];
    const { history, forecast } = splitRecurringBillPayments(payments, "2026-05-28");
    expect(history.map((p) => p.date)).toEqual(["2026-04-01"]);
    expect(forecast.map((p) => p.date)).toEqual(["2027-12-17", "2028-05-17"]);
  });
});

describe("Recurring / Rules pages — canonical next occurrence", () => {
  it("Recurring page loads backend summary", () => {
    expect(recurringPageSource).toMatch(/getRecurringRulesSummary/);
  });

  it("Rules page uses next_occurrence_date, not getNextRuleRunDate", () => {
    expect(rulesPageSource).toMatch(/next_occurrence_date/);
    expect(rulesPageSource).not.toMatch(/getNextRuleRunDate/);
  });
});
