import { describe, expect, it } from "vitest";
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

describe("recurringDisplay", () => {
  it("groups streaming as subscriptions", () => {
    expect(getRecurringGroup(baseRule())).toBe("subscriptions");
  });

  it("labels monthly cadence with ordinal day", () => {
    expect(cadenceLabel(baseRule())).toBe("Monthly · 17th");
  });

  it("formats day-of-month ordinals", () => {
    expect(formatDayOfMonthOrdinal(4)).toBe("4th");
    expect(formatDayOfMonthOrdinal(21)).toBe("21st");
  });

  it("marks linked occurrence as paid for the current cycle", () => {
    expect(
      deriveRecurringPaymentStatus(
        baseRule(),
        baseOccurrence({
          due_date: "2026-05-17",
          status: "late",
          transaction_id: 99,
          matched_transaction_id: 99,
          payment_confidence: "low",
        }),
        "2026-05-17"
      )
    ).toBe("paid");
  });

  it("advances status to due soon when last cycle is paid but next charge is near", () => {
    expect(
      deriveRecurringPaymentStatus(
        baseRule({ day_of_month: 1 }),
        baseOccurrence({
          due_date: "2026-05-01",
          status: "paid",
          paid_date: "2026-05-01",
          transaction_id: 1,
          matched_transaction_id: 1,
        }),
        "2026-05-28"
      )
    ).toBe("due_soon");
  });

  it("marks linked paid occurrence as paid", () => {
    const rules = [baseRule({ name: "Hulu", day_of_month: 4 })];
    expect(
      deriveRecurringPaymentStatus(
        rules[0],
        baseOccurrence({
          name: "Hulu",
          due_date: "2026-05-04",
          amount: "35.00",
          status: "paid",
          paid_date: "2026-05-04",
          transaction_id: 99,
          matched_transaction_id: 99,
          payment_confidence: "high",
        }),
        "2026-05-04"
      )
    ).toBe("paid");
  });

  it("marks past due without match as missed", () => {
    expect(
      deriveRecurringPaymentStatus(
        baseRule(),
        baseOccurrence({ due_date: "2026-05-01", status: "late", days_until_due: -5 }),
        "2026-05-10"
      )
    ).toBe("missed");
  });

  it("marks due within 5 days as due soon", () => {
    expect(
      deriveRecurringPaymentStatus(
        baseRule(),
        baseOccurrence({ due_date: "2026-05-14", days_until_due: 3 }),
        "2026-05-11"
      )
    ).toBe("due_soon");
  });

  it("marks skipped occurrence as skipped", () => {
    expect(
      deriveRecurringPaymentStatus(
        baseRule(),
        baseOccurrence({ skipped: true, status: "skipped" }),
        "2026-05-11"
      )
    ).toBe("skipped");
  });

  it("uses red accent for missed rows", () => {
    expect(recurringPaymentRowAccentClass("missed")).toContain("red");
    expect(recurringPaymentStatusBadgeClass("missed")).toContain("red");
    expect(recurringPaymentRowAccentClass("paid")).toContain("emerald");
    expect(recurringPaymentRowAccentClass("due_soon")).toContain("amber");
  });

  it("advances next date past a paid occurrence", () => {
    const rule = baseRule({ day_of_month: 1 });
    const paidMay = baseOccurrence({
      due_date: "2026-05-01",
      status: "paid",
      paid_date: "2026-05-01",
      transaction_id: 1,
      matched_transaction_id: 1,
    });
    expect(resolveRecurringNextOccurrence(rule, paidMay, "2026-05-28")).toBe("2026-06-01");
  });

  it("keeps next date on unpaid occurrence due date", () => {
    const rule = baseRule({ day_of_month: 2 });
    const unpaid = baseOccurrence({ due_date: "2026-06-02", status: "projected" });
    expect(resolveRecurringNextOccurrence(rule, unpaid, "2026-05-28")).toBe("2026-06-02");
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
        baseRule({ id: 1, name: "Hulu", day_of_month: 4 }),
        baseRule({ id: 2, name: "Netflix", day_of_month: 17 }),
      ],
      []
    );
    const grouped = groupRecurringItemsByDay(items);
    expect(grouped.map((g) => g.day)).toEqual([4, 17]);
    expect(grouped[0]?.label).toBe("4th");
  });

  it("computes summary metrics", () => {
    const items = buildRecurringListItems([baseRule()], []);
    const summary = computeRecurringSummary(items);
    expect(summary.activeRules).toBe(1);
    expect(summary.monthlyRecurringTotal).toBeGreaterThan(0);
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
