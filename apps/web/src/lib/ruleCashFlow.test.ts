import { describe, expect, it } from "vitest";
import type { RecurringRule } from "@budget-app/shared";
import {
  estimatedMonthlyCashFlow,
  getRuleSection,
  isCreditCardExpenseRule,
  ruleCountsTowardMonthlyCashFlow,
  ruleMonthlyAmount,
  sectionMonthlySubtotal,
} from "./ruleCashFlow";

function baseRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 1,
    household: 1,
    name: "Rent",
    account: { id: 1, name: "Chase", account_type: "CHECKING" } as RecurringRule["account"],
    transfer_to_account: null,
    category: null,
    direction: "EXPENSE",
    amount: "1000",
    currency: "USD",
    frequency: "MONTHLY_DAY",
    interval: 1,
    day_of_week: null,
    day_of_month: 1,
    nth_week: null,
    start_date: "2024-01-01",
    end_date: null,
    active: true,
    paused_at: null,
    notes: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const isRunning = (rule: RecurringRule) => rule.active;

describe("ruleCashFlow", () => {
  it("detects expenses charged to credit cards", () => {
    const rule = baseRule({
      name: "Grocery Placeholder",
      account: { id: 2, name: "Savor", account_type: "CREDIT" } as RecurringRule["account"],
      amount: "500",
      frequency: "WEEKLY",
      day_of_week: 0,
    });
    expect(isCreditCardExpenseRule(rule)).toBe(true);
    expect(getRuleSection(rule)).toBe("credit_card_charges");
    expect(ruleCountsTowardMonthlyCashFlow(rule)).toBe(false);
  });

  it("keeps bank-account bills in the bills section and cash flow", () => {
    const rule = baseRule({ name: "ATT Pmt" });
    expect(getRuleSection(rule)).toBe("bills");
    expect(ruleCountsTowardMonthlyCashFlow(rule)).toBe(true);
  });

  it("counts bank card payments but not matching credit card charges", () => {
    const cardCharge = baseRule({
      id: 1,
      name: "Grocery Placeholder",
      account: { id: 2, name: "Savor", account_type: "CREDIT" } as RecurringRule["account"],
      amount: "500",
      frequency: "WEEKLY",
      day_of_week: 0,
    });
    const bankPayment = baseRule({
      id: 2,
      name: "Grocery - Move to Savor",
      account: { id: 1, name: "Chase", account_type: "CHECKING" } as RecurringRule["account"],
      category: { id: 3, name: "Credit Card Payment" } as RecurringRule["category"],
      amount: "500",
      frequency: "WEEKLY",
      day_of_week: 0,
    });

    const rules = [cardCharge, bankPayment];
    const cardMonthly = Math.abs(ruleMonthlyAmount(cardCharge));
    const bankMonthly = Math.abs(ruleMonthlyAmount(bankPayment));
    expect(cardMonthly).toBeCloseTo((52 / 12) * 500, 2);
    expect(bankMonthly).toBeCloseTo((52 / 12) * 500, 2);

    const cashFlow = estimatedMonthlyCashFlow(rules, isRunning);
    expect(Math.abs(cashFlow)).toBeCloseTo(bankMonthly, 2);
    expect(Math.abs(cashFlow)).not.toBeCloseTo(cardMonthly + bankMonthly, 2);
  });

  it("excludes credit card charges from bills section grouping", () => {
    const bankBill = baseRule({ id: 1, name: "ATT Pmt", amount: "200" });
    const cardCharge = baseRule({
      id: 2,
      name: "Grocery Placeholder",
      account: { id: 2, name: "Savor", account_type: "CREDIT" } as RecurringRule["account"],
      amount: "500",
      frequency: "WEEKLY",
      day_of_week: 0,
    });

    expect(getRuleSection(bankBill)).toBe("bills");
    expect(getRuleSection(cardCharge)).toBe("credit_card_charges");
    expect(Math.abs(sectionMonthlySubtotal([bankBill], isRunning))).toBe(200);
    expect(Math.abs(sectionMonthlySubtotal([cardCharge], isRunning))).toBeCloseTo((52 / 12) * 500, 2);
  });

  it("routes credit card subscriptions to credit card charges", () => {
    const rule = baseRule({
      name: "Cursor",
      account: { id: 2, name: "Venture", account_type: "CREDIT" } as RecurringRule["account"],
      category: { id: 1, name: "Software / Apps" } as RecurringRule["category"],
    });
    expect(getRuleSection(rule)).toBe("credit_card_charges");
    expect(ruleCountsTowardMonthlyCashFlow(rule)).toBe(false);
  });

  it("still excludes internal bank transfers from cash flow", () => {
    const transfer = baseRule({
      name: "Move to Savings",
      direction: "TRANSFER",
      transfer_to_account: { id: 3, name: "Savings", account_type: "SAVINGS" } as RecurringRule["account"],
    });
    expect(getRuleSection(transfer)).toBe("transfers");
    expect(ruleCountsTowardMonthlyCashFlow(transfer)).toBe(false);
  });
});
