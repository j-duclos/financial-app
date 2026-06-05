import { describe, expect, it } from "vitest";
import {
  describeOverride,
  describeOneTimeEvent,
  describeCategoryShock,
  buildPlanIncludes,
  isScenarioOnlyRuleAdd,
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
});
