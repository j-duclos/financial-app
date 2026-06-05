import { describe, expect, it } from "vitest";
import {
  isDebtScenarioEvent,
  parseDebtEventType,
  oneTimeDebtDescription,
  filterAssetAccounts,
  filterDebtAccounts,
  findDebtPaymentRules,
  formatUtilizationAtHorizonLine,
  buildDebtImpactHighlights,
} from "./scenarioDebtPayment";
import type { PlanIncludeItem } from "./scenarioPlainLanguage";
import type { RecurringRule } from "@budget-app/shared";
import type { Account, ScenarioOneTimeEvent } from "@budget-app/shared";

const checking = { id: 1, name: "Main Checking", account_type: "CHECKING" } as Account;
const venture = {
  id: 2,
  name: "Venture",
  account_type: "CREDIT",
  balance_owed: "1220.44",
  credit_limit: "1000",
} as Account;

describe("scenarioDebtPayment", () => {
  it("filters asset and debt accounts", () => {
    expect(filterAssetAccounts([checking, venture]).map((a) => a.id)).toEqual([1]);
    expect(filterDebtAccounts([checking, venture]).map((a) => a.id)).toEqual([2]);
  });

  it("detects debt transfer events", () => {
    const ev = {
      direction: "TRANSFER",
      transfer_to_account: venture,
      account: checking,
      notes: "what_if_debt:one_time",
      description: "Debt payment",
      amount: "500",
    } as ScenarioOneTimeEvent;
    expect(isDebtScenarioEvent(ev)).toBe(true);
    expect(parseDebtEventType(ev)).toBe("one_time");
  });

  it("detects pay full from amount matching balance", () => {
    const ev = {
      direction: "TRANSFER",
      transfer_to_account: venture,
      account: checking,
      notes: "what_if_debt:pay_full",
      description: "Pay off Venture",
      amount: "1220.44",
    } as ScenarioOneTimeEvent;
    expect(parseDebtEventType(ev)).toBe("pay_full");
  });

  it("builds pay-off summary copy", () => {
    expect(oneTimeDebtDescription("pay_full", "Main Checking", "Venture")).toBe(
      "Pay off Venture in full using Main Checking"
    );
  });

  it("finds credit card payment rules with EXPENSE direction", () => {
    const careCredit = { id: 2, name: "Care Credit", account_type: "CREDIT" } as Account;
    const rules = [
      {
        id: 10,
        name: "Care Credit Card Pmt",
        active: true,
        direction: "EXPENSE",
        amount: "393.79",
        currency: "USD",
        transfer_to_account_id: 2,
        transfer_to_account: careCredit,
        category: { name: "Credit Card Payment" },
        account: { id: 1, name: "Chase" },
      },
      {
        id: 11,
        name: "Amazon Credit Card Payment",
        active: true,
        direction: "EXPENSE",
        amount: "40",
        currency: "USD",
        transfer_to_account_id: 3,
        category: { name: "Credit Card Payment" },
      },
    ] as RecurringRule[];

    const matched = findDebtPaymentRules(rules, 2, [checking, careCredit]);
    expect(matched).toHaveLength(1);
    expect(matched[0].name).toBe("Care Credit Card Pmt");
  });

  it("matches card payment by name when pay-to account was never linked", () => {
    const careCredit = { id: 2, name: "Care Credit", account_type: "CREDIT" } as Account;
    const rules = [
      {
        id: 10,
        name: "Care Credit Card Pmt",
        active: true,
        direction: "EXPENSE",
        amount: "393.79",
        currency: "USD",
        category: { name: "Credit Card Payment" },
      },
    ] as RecurringRule[];

    expect(findDebtPaymentRules(rules, 2, [careCredit])).toHaveLength(1);
  });

  it("formats utilization at horizon end date, including paid off", () => {
    expect(
      formatUtilizationAtHorizonLine(
        {
          account_id: 2,
          account_name: "Savor",
          base_balance_owed: "637",
          scenario_balance_owed: "0",
          base_utilization_percent: "63.7",
          scenario_utilization_percent: "0",
        },
        "2027-05-29"
      )
    ).toBe("by 05-29-27, Savor is paid off (was 63.7% utilization)");

    expect(
      formatUtilizationAtHorizonLine(
        {
          account_id: 2,
          account_name: "Savor",
          base_balance_owed: "637",
          scenario_balance_owed: "512",
          base_utilization_percent: "63.7",
          scenario_utilization_percent: "51.2",
        },
        "2027-05-29"
      )
    ).toBe("by 05-29-27, Savor utilization 63.7% → 51.2%");
  });

  it("buildDebtImpactHighlights omits misleading single-payment utilization", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 1, scenario: 0, delta: "-1" },
        lowest_projected_balance: { base: "100", scenario: "200.41", delta: "100.41" },
        credit_debt_after_horizon: { base: "1000", scenario: "800", delta: "-200" },
      },
    } as import("@budget-app/shared").ScenarioComparisonResponse;

    const planItems = [
      {
        impactKind: "debt",
        accountLabel: "Chase → Savor",
        actionLabel: "extra",
        detailLabel: "$250.00 monthly\nChase → Savor",
      },
    ] as PlanIncludeItem[];

    const lines = buildDebtImpactHighlights(comparison, planItems);
    expect(lines.some((l) => l.includes("utilization falls"))).toBe(false);
    expect(lines.some((l) => l.includes("credit debt drops"))).toBe(true);
  });
});
