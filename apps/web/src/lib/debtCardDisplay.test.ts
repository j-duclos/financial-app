import { describe, expect, it } from "vitest";
import type { DebtPayoffCardSummary, DebtPayoffPlan, PayoffProjection } from "@budget-app/shared";
import {
  debtCardOutcomeLines,
  drawerForecastRows,
  portfolioImpactMessage,
} from "./debtCardDisplay";

const planCard = (overrides: Partial<DebtPayoffCardSummary> = {}): DebtPayoffCardSummary => ({
  account_id: 1,
  name: "Venture",
  balance: "1200.00",
  apr: "24.00",
  credit_limit: "5000.00",
  utilization_percent: "24.00",
  minimum_payment: "40.00",
  suggested_payment: "150.00",
  payoff_date: "2027-06-01",
  months_remaining: 10,
  total_projected_interest: "164.00",
  interest_this_month: "24.00",
  payoff_order: 1,
  promotional_apr: null,
  promotional_end_date: null,
  autopay_enabled: false,
  ...overrides,
});

const projection = (overrides: Partial<PayoffProjection> = {}): PayoffProjection => ({
  payoff_possible: true,
  starting_balance: "1200.00",
  apr: "24.00",
  monthly_interest_rate: "0.02",
  payment_amount: "200.00",
  payoff_date: "2027-04-01",
  months_to_payoff: 8,
  total_interest: "120.00",
  total_paid: "1320.00",
  schedule: [],
  ...overrides,
});

const plan = (overrides: Partial<DebtPayoffPlan> = {}): DebtPayoffPlan =>
  ({
    months_to_debt_free: 22,
    ...overrides,
  }) as DebtPayoffPlan;

describe("debtCardOutcomeLines", () => {
  it("emphasizes payoff timeline and interest", () => {
    const lines = debtCardOutcomeLines(planCard());
    expect(lines.headline).toMatch(/10 months/);
    expect(lines.suggestedLine).toMatch(/150/);
    expect(lines.interestLine).toMatch(/164/);
  });
});

describe("portfolioImpactMessage", () => {
  it("mentions household debt-free for priority card", () => {
    const msg = portfolioImpactMessage(
      plan(),
      planCard({ payoff_order: 1 }),
      projection({ months_to_payoff: 8 })
    );
    expect(msg).toMatch(/overall debt-free/i);
  });

  it("describes card-only savings for non-priority cards", () => {
    const msg = portfolioImpactMessage(
      plan(),
      planCard({ payoff_order: 2 }),
      projection({ months_to_payoff: 6 })
    );
    expect(msg).toMatch(/clears this card 4 months/i);
  });
});

describe("drawerForecastRows", () => {
  it("formats aligned forecast values", () => {
    const rows = drawerForecastRows(projection(), planCard(), plan());
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(byLabel["Payoff date"]).toBe("04-01-27");
    expect(byLabel.Timeline).toBe("8 mo");
    expect(byLabel["Total interest"]).toMatch(/120/);
    expect(byLabel.Payment).toMatch(/200/);
    expect(byLabel["vs plan"]).toMatch(/faster/);
  });

  it("shows won't shrink when minimum is below interest", () => {
    const rows = drawerForecastRows(
      projection({ payoff_possible: false, payment_amount: "25.49" }),
      planCard({ interest_this_month: "30.00" }),
      plan()
    );
    expect(rows.find((r) => r.label === "Timeline")?.value).toBe("Won't shrink");
  });
});
