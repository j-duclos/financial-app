import { describe, expect, it } from "vitest";
import {
  describeOverride,
  describeOneTimeEvent,
  describeCategoryShock,
  buildPlanIncludes,
  isScenarioOnlyRuleAdd,
  planItemDisplayDetail,
} from "./scenarioPlainLanguage";

describe("scenarioPlainLanguage", () => {
  it("describes canceled subscription", () => {
    expect(
      describeOverride({
        id: 1,
        scenario: 1,
        rule: { id: 1, name: "Netflix", amount: "15.99", currency: "USD" } as never,
        override_active: false,
        override_amount: null,
        override_start_date: null,
        override_end_date: null,
        override_account: null,
        override_category: null,
        notes: "",
        created_at: "",
        updated_at: "",
      })
    ).toBe("Netflix canceled");
  });

  it("describes income event", () => {
    expect(
      describeOneTimeEvent({
        id: 1,
        scenario: 1,
        date: "2026-04-04",
        description: "Bonus",
        direction: "INCOME",
        amount: "500",
        account: { name: "Checking" } as never,
        category: null,
        notes: "",
        created_at: "",
        updated_at: "",
      })
    ).toContain("Extra income");
    expect(describeOneTimeEvent({
      id: 1,
      scenario: 1,
      date: "2026-04-04",
      description: "Bonus",
      direction: "INCOME",
      amount: "500",
      account: { name: "Checking" } as never,
      category: null,
      notes: "",
      created_at: "",
      updated_at: "",
    })).toContain("$500.00");
  });

  it("describes category shock", () => {
    expect(
      describeCategoryShock({
        id: 1,
        scenario: 1,
        category: { name: "Groceries" } as never,
        percent_change: "20",
        start_date: "2026-07-01",
        end_date: null,
        created_at: "",
        updated_at: "",
      })
    ).toContain("Groceries");
    expect(
      describeCategoryShock({
        id: 1,
        scenario: 1,
        category: { name: "Groceries" } as never,
        percent_change: "20",
        start_date: "2026-07-01",
        end_date: null,
        created_at: "",
        updated_at: "",
      })
    ).toContain("20%");
  });

  it("sorts plan includes by date", () => {
    const items = buildPlanIncludes(
      [],
      [
        {
          id: 2,
          scenario: 1,
          date: "2026-05-01",
          description: "Rent",
          direction: "EXPENSE",
          amount: "200",
          account: {} as never,
          category: null,
          notes: "",
          created_at: "",
          updated_at: "",
        },
        {
          id: 1,
          scenario: 1,
          date: "2026-04-04",
          description: "Bonus",
          direction: "INCOME",
          amount: "500",
          account: {} as never,
          category: null,
          notes: "",
          created_at: "",
          updated_at: "",
        },
      ],
      []
    );
    expect(items[0].sortDate).toBe("2026-04-04");
  });

  it("titles paycheck increases without the raw bank description", () => {
    const items = buildPlanIncludes(
      [
        {
          id: 1,
          scenario: 1,
          rule: {
            id: 9,
            name: "2930 JOHN GALT S PAYROLL PPD ID: 14409866",
            amount: "1835.52",
            currency: "USD",
            direction: "INCOME",
            frequency: "BIWEEKLY",
            account: { name: "Chase" },
          } as never,
          override_active: true,
          override_amount: "2500",
          override_start_date: null,
          override_end_date: null,
          override_account: null,
          override_category: null,
          notes: "",
          created_at: "",
          updated_at: "",
        },
      ],
      [],
      []
    );
    expect(items[0].actionLabel).toBe("Increase paycheck");
    expect(items[0].title).toContain("JOHN GALT");
    expect(items[0].detailLabel).toContain("1,835.52");
    expect(items[0].detailLabel).toContain("2,500.00");
  });

  it("compacts transfer and extra-payment titles", () => {
    const items = buildPlanIncludes(
      [],
      [
        {
          id: 1,
          scenario: 1,
          date: "2026-05-30",
          description: "extra",
          direction: "TRANSFER",
          amount: "500",
          account: { name: "Chase Savings" } as never,
          transfer_to_account: { name: "Chase" } as never,
          category: null,
          notes: "",
          created_at: "",
          updated_at: "",
        },
      ],
      [],
      [
        {
          id: 2,
          scenario: 1,
          name: "extra",
          amount: "250",
          currency: "USD",
          direction: "TRANSFER",
          frequency: "MONTHLY_DAY",
          interval: 1,
          day_of_week: null,
          day_of_month: 1,
          nth_week: null,
          start_date: "2026-05-01",
          end_date: null,
          notes: "what_if_debt_recurring",
          account: { name: "Chase", account_type: "CHECKING" } as never,
          transfer_to_account: { name: "Savor", account_type: "CREDIT" } as never,
          category: null,
          created_at: "",
          updated_at: "",
        } as never,
      ]
    );
    const transfer = items.find((i) => i.kind === "event");
    expect(transfer?.actionLabel).toBe("Transfer $500.00");
    expect(planItemDisplayDetail(transfer!)).toContain("Chase Savings → Chase");
    expect(planItemDisplayDetail(transfer!)).toContain("May 30, 2026");
  });
});
