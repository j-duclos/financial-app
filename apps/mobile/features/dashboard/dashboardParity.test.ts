import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DashboardAttentionItem, DashboardUpcomingGroup, DashboardUpcomingTransaction } from "@budget-app/shared";
import {
  attentionAccountTypeLabel,
  attentionActionLine,
  attentionCardsForDisplay,
  attentionPrimaryIssue,
  attentionSeverityLabel,
  buildUpcomingDashboardPreview,
  dashboardGoalStatusDisplay,
  upcomingTransactionNavTarget,
} from "@budget-app/shared";
import {
  accountDetailPath,
  accountsAttentionFilterPath,
  attentionCardAccessibilityLabel,
  attentionCardOpensLedger,
  attentionCardTapDestination,
} from "./navigation";
import { attentionPrimaryIssueDisplay } from "./display";
import {
  transactionsForForecastRiskPath,
} from "@/features/payment-planner/navigation";
import { upcomingMoneyFlowRowDestination } from "./navigation";

const dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardScreen.tsx"),
  "utf8"
);
const attentionCardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DashboardAttentionCard.tsx"),
  "utf8"
);

function sampleAttention(overrides: Partial<DashboardAttentionItem> = {}): DashboardAttentionItem {
  return {
    account_id: 1,
    account_name: "Main",
    account_role: "spending",
    account_type: "CHECKING",
    status: "critical",
    reason: "Projected negative Aug 27",
    recommended_action: "Add $1,406.40 before Aug 27.",
    amount: "1406.40",
    risk_date: "2026-08-27",
    url: "/accounts?account=1",
    primary_action: { label: "Open ledger", type: "open_ledger", url: "/transactions" },
    secondary_action: { label: "Move money", type: "move_money", url: "/accounts?account=1" },
    ...overrides,
  };
}

function creditUtilizationAttention(): DashboardAttentionItem {
  return sampleAttention({
    account_id: 5,
    account_name: "Care Credit",
    account_type: "CREDIT",
    account_role: "credit_card",
    reason: "Utilization is 22%",
    recommended_action: "Pay $590.96 to reach your 10% target.",
    amount: "590.96",
    risk_date: null,
    primary_action: { label: "Make payment", type: "make_payment", url: "/credit-cards?account=5" },
    secondary_action: null,
  });
}

function txn(overrides: Partial<DashboardUpcomingTransaction> = {}): DashboardUpcomingTransaction {
  return {
    id: "42",
    date: "2026-08-28",
    account_id: 1,
    account_name: "Main",
    description: "Chewy",
    amount: "-79.46",
    kind: "bill",
    category: null,
    balance_after: "-750.34",
    is_transfer: false,
    is_internal_transfer: false,
    is_credit_card_payment: false,
    source: "rule",
    status: "PLANNED",
    risk_flag: false,
    ...overrides,
  };
}

function group(overrides: Partial<DashboardUpcomingGroup> = {}): DashboardUpcomingGroup {
  return {
    date: "2026-08-28",
    label: "Aug 28",
    day_of_week: "Fri",
    income_total: "0.00",
    expense_total: "79.46",
    net_total: "-79.46",
    transfer_total: "0.00",
    transfers_excluded: false,
    has_risk: false,
    risk_reason: null,
    transactions: [txn()],
    hidden_transaction_count: 0,
    total_transaction_count: 1,
    ...overrides,
  };
}

describe("Dashboard attention parity", () => {
  it("does not route cards or view all to action center", () => {
    expect(dashboardSource).not.toMatch(/action-center/);
    expect(attentionCardSource).not.toMatch(/action-center/);
  });

  it("does not render desktop-style action buttons on attention cards", () => {
    expect(attentionCardSource).not.toMatch(/ActionButton/);
    expect(attentionCardSource).not.toMatch(/Open ledger/);
    expect(attentionCardSource).not.toMatch(/View account/);
    expect(attentionCardSource).not.toMatch(/Payment Planner/);
    expect(attentionCardSource).not.toMatch(/paymentPlannerAccountPath/);
  });

  it("uses a single card press target with chevron", () => {
    expect(attentionCardSource).toMatch(/attentionCardTapDestination/);
    expect(attentionCardSource).toMatch(/chevron-right/);
    expect(attentionCardSource).toMatch(/accessibilityLabel=\{accessibilityLabel\}/);
  });

  it("matches compact attention card hierarchy from dashboard mock", () => {
    expect(attentionCardSource).toMatch(/AccountTypePill/);
    expect(attentionCardSource).toMatch(/attentionPrimaryIssueDisplay/);
    expect(attentionCardSource).toMatch(/AttentionActionText/);
    expect(attentionCardSource).not.toMatch(/marginTop: 2,\s*\}\}\>\s*\{attentionAccountTypeLabel/);
  });

  it("formats issue lines with colon shorthand for dashboard cards", () => {
    expect(attentionPrimaryIssueDisplay("Projected negative Aug 27")).toBe("Projected negative: Aug 27");
    expect(attentionPrimaryIssueDisplay("Utilization is 22%")).toBe("Utilization: 22%");
  });

  it("shows account type label and severity", () => {
    expect(attentionAccountTypeLabel(sampleAttention())).toBe("Checking");
    expect(attentionAccountTypeLabel(creditUtilizationAttention())).toBe("Credit");
    expect(attentionSeverityLabel(sampleAttention().status)).toBe("Critical");
  });

  it("keeps recommendation wording on the card", () => {
    const cash = sampleAttention();
    expect(attentionPrimaryIssue(cash)).toBe("Projected negative Aug 27");
    expect(attentionActionLine(cash)).toBe("Add $1,406.40 before Aug 27.");

    const credit = creditUtilizationAttention();
    expect(attentionPrimaryIssue(credit)).toBe("Utilization is 22%");
    expect(attentionActionLine(credit)).toBe("Pay $590.96 to reach your 10% target.");
  });

  it("cash shortfall card opens filtered transactions for Main", () => {
    const cash = sampleAttention();
    expect(attentionCardOpensLedger(cash)).toBe(true);
    expect(attentionCardTapDestination(cash)).toEqual(
      transactionsForForecastRiskPath({
        accountId: 1,
        accountName: "Main",
        focusDate: "2026-08-27",
        focusTransactionId: null,
      })
    );
    expect(attentionCardAccessibilityLabel(cash)).toContain("Opens account transactions at the forecast risk.");
  });

  it("cash shortfall with causing transaction preserves risk focus params", () => {
    const cash = sampleAttention({ first_negative_transaction_id: 99, risk_date: "2026-09-02" });
    expect(attentionCardTapDestination(cash)).toEqual(
      transactionsForForecastRiskPath({
        accountId: 1,
        accountName: "Main",
        focusDate: "2026-09-02",
        focusTransactionId: 99,
      })
    );
  });

  it("credit utilization card opens account details for Care Credit", () => {
    const credit = creditUtilizationAttention();
    expect(attentionCardOpensLedger(credit)).toBe(false);
    expect(attentionCardTapDestination(credit)).toEqual(accountDetailPath(5));
    expect(attentionCardAccessibilityLabel(credit)).toContain("Opens account details.");
    expect(attentionCardTapDestination(credit)).not.toEqual({
      pathname: "/payment-planner",
      params: { account: "5" },
    });
  });

  it("view all routes to accounts attention filter", () => {
    expect(accountsAttentionFilterPath()).toEqual({
      pathname: "/(app)/(tabs)/accounts",
      params: { attention: "1" },
    });
  });

  it("filters actionable attention cards", () => {
    const cards = attentionCardsForDisplay([
      sampleAttention(),
      sampleAttention({ account_id: 2, status: "healthy" }),
    ]);
    expect(cards).toHaveLength(1);
  });
});

describe("Dashboard upcoming preview", () => {
  it("uses individual transactions not merely first five day groups", () => {
    const groups = [
      group({ date: "2026-08-28", transactions: [txn({ id: "1", description: "Chewy" })] }),
      group({
        date: "2026-08-29",
        transactions: [txn({ id: "2", date: "2026-08-29", description: "Payroll", amount: "1835.52" })],
      }),
      group({ date: "2026-08-30", transactions: [txn({ id: "3", date: "2026-08-30", description: "Rent" })] }),
      group({ date: "2026-08-31", transactions: [txn({ id: "4", date: "2026-08-31", description: "Gas" })] }),
      group({ date: "2026-09-01", transactions: [txn({ id: "5", date: "2026-09-01", description: "Spotify" })] }),
      group({ date: "2026-09-02", transactions: [txn({ id: "6", date: "2026-09-02", description: "Extra" })] }),
    ];
    const preview = buildUpcomingDashboardPreview(groups, undefined, "2026-08-26");
    expect(preview.transactions).toHaveLength(5);
    expect(preview.transactions[0].txn.description).toBe("Chewy");
    expect(preview.transactions.some((row) => row.txn.description === "Extra")).toBe(false);
  });

  it("navigates money flow rows to Transactions ledger focus", () => {
    expect(upcomingTransactionNavTarget(txn({ id: "99", transaction_id: 99 }))).toEqual({
      type: "ledger",
      accountId: 1,
      accountName: "Main",
      focusDate: "2026-08-28",
      focusTransactionId: 99,
      focusRuleId: null,
      focusEventId: "99",
    });
    expect(upcomingMoneyFlowRowDestination(txn({ id: "xfer-out-in", transaction_id: 501, account_id: 1 })))
      .toMatchObject({
        pathname: "/(app)/(tabs)/transactions",
        params: { account: "1", focus: "ledger-event", focusTransactionId: "501" },
      });
  });
});

describe("Dashboard goal status", () => {
  it("shows explicit pace/on-track status labels", () => {
    expect(
      dashboardGoalStatusDisplay({ pace_status: "behind", on_track_status: "behind" })?.label
    ).toBe("Behind");
    expect(
      dashboardGoalStatusDisplay({ pace_status: "on_track", on_track_status: "on_track" })?.label
    ).toBe("On track");
    expect(
      dashboardGoalStatusDisplay({ pace_status: "stalled", on_track_status: "behind" })?.label
    ).toBe("Stalled");
    expect(
      dashboardGoalStatusDisplay({ pace_status: "completed", on_track_status: "ahead" })?.label
    ).toBe("Complete");
  });
});
