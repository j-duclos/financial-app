import { describe, it, expect } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  accountListHealthDetailLines,
  buildAccountListHealthReason,
  formatLowestProjectedWindowLine,
  healthInlineLabel,
} from "./accountHealthDisplay";

function mockAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    household: { id: 1, name: "Home", created_at: "", updated_at: "" },
    account_type: "CHECKING",
    role: "spending",
    name: "Main",
    institution: "Chase",
    currency: "USD",
    is_active: true,
    created_at: "",
    updated_at: "",
    lowest_projected_balance_30_days: "-37.06",
    risk_date: "2026-06-17",
    upcoming_outflows_30_days: "10168.11",
    health_recommended_action: "Move $37.06 into this account before 2026-06-17.",
    ...overrides,
  } as Account;
}

describe("healthInlineLabel", () => {
  it("combines status and reason", () => {
    expect(healthInlineLabel("watch", "Safe-to-spend is low relative to balance")).toBe(
      "Watch — Safe-to-spend is low relative to balance"
    );
  });

  it("uses default reason for healthy when none provided", () => {
    expect(healthInlineLabel("healthy", null)).toBe("Healthy — Above buffer");
  });
});

describe("buildAccountListHealthReason", () => {
  it("includes move amount and date for critical cash accounts", () => {
    const account = mockAccount();
    expect(
      buildAccountListHealthReason("Projected balance drops below zero on 2026-06-17", account)
    ).toBe(
      "Projected balance drops to -$37.06 on 06-17-26: Move $37.06 before 06-17-26"
    );
  });

  it("shows both projected low and safe-to-spend when they differ", () => {
    const account = mockAccount({
      lowest_projected_balance_30_days: "-305.14",
      available_to_spend: "-362.88",
      risk_date: "2026-06-17",
    });
    expect(
      buildAccountListHealthReason("Projected balance drops below zero on 2026-06-17", account)
    ).toBe(
      "Projected balance drops to -$305.14 on 06-17-26; Safe to spend is -$362.88. Move $362.88 before 06-17-26"
    );
  });

  it("uses first negative balance for move amount when available", () => {
    const account = mockAccount({
      lowest_projected_balance_30_days: "-362.88",
      first_negative_balance: "-305.14",
      available_to_spend: "-362.88",
      risk_date: "2026-05-28",
    });
    expect(
      buildAccountListHealthReason("Projected balance drops below zero on 2026-05-28", account)
    ).toBe(
      "Projected balance drops to -$362.88 on 05-28-26: Move $305.14 before 05-28-26"
    );
  });

  it("rewrites utilization in health reason from API utilization_percent", () => {
    const account = mockAccount({
      account_type: "CREDIT",
      utilization_percent: "53.73",
      target_utilization_percent: "10",
    });
    expect(
      buildAccountListHealthReason("Utilization is 90% (target 10%): Reduce card utilization", account)
    ).toBe("Utilization is 54% (target 10%): Reduce card utilization");
  });

  it("suggests payment toward card when over the limit", () => {
    const account = mockAccount({
      id: 2,
      account_type: "CREDIT",
      role: "credit_card",
      name: "Venture",
      display_name: "Venture",
      credit_limit: "1000",
      current_balance: "1231.20",
      utilization_percent: "123.12",
      target_utilization_percent: "10",
      lowest_projected_balance_30_days: null,
      risk_date: null,
    });
    expect(
      buildAccountListHealthReason("Utilization is 123%", account)
    ).toBe("Utilization is 123% (target 10%): Pay $231.20 toward Venture");
  });
});

describe("accountListHealthDetailLines", () => {
  it("only shows upcoming outflows (no duplicate lowest, risk date, or action)", () => {
    const lines = accountListHealthDetailLines(mockAccount());
    expect(lines).toEqual(["Upcoming outflows: $10,168.11"]);
  });
});

describe("formatLowestProjectedWindowLine", () => {
  it("uses the selected forecast window in the label", () => {
    expect(formatLowestProjectedWindowLine("Main", mockAccount(), 60)).toBe(
      "Main: Lowest projected in next 60 days: -$37.06 on 06-17-26"
    );
  });
});
