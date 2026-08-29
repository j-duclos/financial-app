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
  it("exposes projected negative with the shortfall date", () => {
    const account = mockAccount({
      health_reason_code: "forecast_negative",
      first_negative_date: "2026-06-17",
      first_negative_balance: "-37.06",
    });
    expect(
      buildAccountListHealthReason("Projected negative 2026-06-17", account)
    ).toBe("Projected negative 06-17-26");
  });

  it("maps legacy below-zero copy to projected negative", () => {
    const account = mockAccount({
      first_negative_date: "2026-06-17",
      first_negative_balance: "-305.14",
      available_to_spend: "-362.88",
    });
    expect(
      buildAccountListHealthReason("Projected balance drops below zero on 2026-06-17", account)
    ).toBe("Projected negative 06-17-26");
  });

  it("prefers first shortfall date when lowest projected differs", () => {
    const account = mockAccount({
      health_reason_code: "forecast_negative",
      lowest_projected_balance_30_days: "-1691.36",
      lowest_projected_balance_date_30_days: "2026-09-10",
      first_negative_balance: "-996.62",
      first_negative_date: "2026-08-20",
      available_to_spend: "-1691.36",
      risk_date: "2026-08-20",
    });
    expect(
      buildAccountListHealthReason("Projected negative 2026-08-20", account)
    ).toBe("Projected negative 08-20-26");
  });

  it("compacts credit past-due copy instead of repeating the recommended action", () => {
    const account = mockAccount({
      account_type: "CREDIT",
      role: "credit_card",
      name: "Care Credit",
      health_reason_code: "payment_past_due",
      next_payment_due_date: "2026-07-26",
      health_recommended_action: "Schedule a payment immediately to avoid late fees.",
    });
    expect(buildAccountListHealthReason("Payment is past due", account)).toBe(
      "Past due since 07-26-26"
    );
  });

  it("passes through backend utilization reason text", () => {
    const account = mockAccount({
      account_type: "CREDIT",
      health_reason_code: "high_utilization",
      utilization_percent: "96",
      target_utilization_percent: "10",
    });
    expect(
      buildAccountListHealthReason("High utilization · Above 10% target", account)
    ).toBe("High utilization · Above 10% target");
  });

  it("passes through soft above-target utilization without severity", () => {
    const account = mockAccount({
      account_type: "CREDIT",
      health_status: "healthy",
      health_reason_code: "utilization_above_target",
      utilization_percent: "22",
      target_utilization_percent: "10",
      health_details: { utilization_label: "Above 10% target" } as Account["health_details"],
    });
    expect(buildAccountListHealthReason("Above 10% target", account)).toBe(
      "Above 10% target"
    );
  });

  it("keeps an actionable low-payment warning compact", () => {
    const account = mockAccount({
      account_type: "CREDIT",
      role: "credit_card",
      name: "Savor",
    });
    expect(
      buildAccountListHealthReason(
        "Planned $25 payment may not cover ~$63/mo interest. Increase to at least ~$64/mo to begin reducing principal.",
        account
      )
    ).toContain("Planned $25");
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
      balance_owed: "1231.20",
      utilization_percent: "123.12",
      target_utilization_percent: "10",
      lowest_projected_balance_30_days: null,
      risk_date: null,
    });
    expect(
      buildAccountListHealthReason("Utilization is 123%", account)
    ).toBe("Over credit limit · Above 10% target: Pay $231.20 toward Venture");
  });
});

describe("accountListHealthDetailLines", () => {
  it("only shows upcoming outflows (no duplicate lowest, risk date, or action)", () => {
    const lines = accountListHealthDetailLines(mockAccount());
    expect(lines).toEqual(["Upcoming outflows: $10,168.11"]);
  });
});

describe("formatLowestProjectedWindowLine", () => {
  it("uses the selected forecast window and lowest-projected date", () => {
    expect(
      formatLowestProjectedWindowLine("Main", mockAccount(), 30)
    ).toContain("Lowest projected in next 30 days");
  });
});
