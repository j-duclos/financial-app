import { describe, expect, it } from "vitest";
import type { DashboardAttentionItem } from "./types";
import {
  attentionAccountTypeLabel,
  attentionActionLine,
  attentionCardsForDisplay,
  attentionFilterActionable,
  attentionPrimaryIssue,
  attentionPrimaryLabel,
  attentionSecondaryLabel,
  attentionShowsActionLine,
} from "./attentionCardDisplay";
import { buildUpcomingDashboardPreview, upcomingTransactionNavTarget } from "./upcomingDisplay";
import { dashboardGoalStatusDisplay } from "./goalDisplay";

function sampleItem(overrides: Partial<DashboardAttentionItem> = {}): DashboardAttentionItem {
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

describe("shared attentionCardDisplay", () => {
  it("shows account type and structured issue/action lines", () => {
    const item = sampleItem();
    expect(attentionAccountTypeLabel(item)).toBe("Checking");
    expect(attentionPrimaryIssue(item)).toBe("Projected negative Aug 27");
    expect(attentionActionLine(item)).toContain("Add $1,406.40");
    expect(attentionShowsActionLine(item)).toBe(true);
    expect(attentionPrimaryLabel(item)).toBe("Open ledger");
    expect(attentionSecondaryLabel(item)).toBe("Fix Shortfall");
  });

  it("filters actionable items for dashboard cards", () => {
    const items = [sampleItem(), sampleItem({ account_id: 2, status: "healthy" })];
    expect(attentionFilterActionable(items)).toHaveLength(1);
    expect(attentionCardsForDisplay(items)).toHaveLength(1);
  });
});

describe("shared upcoming preview", () => {
  it("exports buildUpcomingDashboardPreview", () => {
    expect(typeof buildUpcomingDashboardPreview).toBe("function");
  });
});

describe("shared goal status", () => {
  it("prefers pace_status over on_track_status", () => {
    expect(
      dashboardGoalStatusDisplay({ pace_status: "ahead", on_track_status: "behind" })?.label
    ).toBe("AHEAD");
  });
});

describe("shared upcomingTransactionNavTarget", () => {
  it("returns ledger focus targets for money flow rows", () => {
    expect(
      upcomingTransactionNavTarget({
        id: "12",
        date: "2026-08-28",
        account_id: 1,
        account_name: "Main",
        description: "Electric bill",
        amount: "-405.00",
        kind: "bill",
        category: null,
        balance_after: null,
        is_transfer: false,
        is_internal_transfer: false,
        is_credit_card_payment: false,
        transaction_id: 12,
        source: null,
        status: null,
        risk_flag: false,
      })
    ).toEqual({
      type: "ledger",
      accountId: 1,
      accountName: "Main",
      focusDate: "2026-08-28",
      focusTransactionId: 12,
      focusRuleId: null,
      focusEventId: "12",
      focusDescription: "Electric bill",
    });
  });
});
