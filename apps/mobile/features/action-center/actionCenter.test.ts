import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DashboardRecommendation } from "@budget-app/shared";
import {
  recommendationCardCopy,
} from "@budget-app/shared";
import {
  accountDetailPath,
  getRecommendationDestination,
  getRecommendationSecondaryActions,
  openLedgerNavigation,
  openPaymentPlannerNavigation,
  recommendationActions,
  resolveRecommendationWebUrl,
  transferPresetPath,
} from "./navigation";
import { actionCenterQueryKeys } from "./queryKeys";

const dir = dirname(fileURLToPath(import.meta.url));
const actionCenterSource = readFileSync(join(dir, "ActionCenterScreen.tsx"), "utf8");
const cardSource = readFileSync(join(dir, "RecommendationCard.tsx"), "utf8");
const survivalSource = readFileSync(join(dir, "SurvivalModeBanner.tsx"), "utf8");
const overflowSource = readFileSync(join(dir, "RecommendationOverflowSheet.tsx"), "utf8");
const routeSource = readFileSync(join(dir, "../../app/(app)/action-center.tsx"), "utf8");

function utilizationRec(): DashboardRecommendation {
  return {
    id: "utilization-5-10",
    severity: "critical",
    title: "Care Credit",
    why: "Utilization is 22%",
    recommended_action: "Pay $590.96 to reach your 10% target.",
    impact_label: null,
    impact_value: null,
    primary_action_label: "Make payment",
    primary_action_url: "/credit-cards?account=5",
    primary_action_type: "navigate",
    secondary_action_label: null,
    secondary_action_url: null,
    secondary_action_type: null,
    type: "reduce_utilization",
    account_id: 5,
    impact_type: "credit_utilization",
  };
}

function cashShortfallRec(): DashboardRecommendation {
  return {
    id: "attention-1",
    severity: "critical",
    title: "Main",
    why: "Projected negative Aug 27",
    recommended_action: "Add $1,406.40 before Aug 27.",
    impact_label: "Amount",
    impact_value: "1406.40",
    primary_action_label: "Open ledger",
    primary_action_url: "/transactions?account=1",
    primary_action_type: "open_ledger",
    secondary_action_label: "Move money",
    secondary_action_url: "/accounts?account=1",
    secondary_action_type: "move_money",
    type: "move_money",
    account_id: 1,
    related_account_id: 2,
    recommended_amount: "1406.40",
    recommended_date: "2026-08-27",
    transaction_id: 42,
  };
}

describe("Action Center route", () => {
  it("no longer uses PlaceholderScreen", () => {
    expect(routeSource).not.toMatch(/PlaceholderScreen/);
    expect(routeSource).toMatch(/ActionCenterScreen/);
  });

  it("uses canonical getRecommendations API", () => {
    expect(actionCenterSource).toMatch(/getRecommendations/);
    expect(actionCenterSource).not.toMatch(/getDashboardSummary/);
  });

  it("uses single recommendations query key", () => {
    expect(actionCenterQueryKeys.recommendations(30)).toEqual([
      "recommendations",
      "action-center",
      30,
    ]);
  });
});

describe("Action Center presentation", () => {
  it("credit utilization wording uses the configured fixture target", () => {
    const fixtureTarget = 10;
    const rec = utilizationRec();
    expect(rec.recommended_action).toContain(`${fixtureTarget}% target`);
  });

  it("shows issue and action lines for cash shortfall", () => {
    const copy = recommendationCardCopy(cashShortfallRec());
    expect(copy.condition).toContain("Aug 27");
    expect(copy.action).toContain("$1,406.40");
  });
});

describe("mobile recommendation card UX", () => {
  it("normal cards have no multi-button action rows", () => {
    expect(cardSource).not.toMatch(/ActionButton/);
    expect(cardSource).not.toMatch(/actions\.map\(/);
    expect(cardSource).not.toMatch(/flexWrap:\s*"wrap",\s*gap:\s*8/);
    expect(cardSource).toMatch(/getRecommendationDestination/);
    expect(cardSource).toMatch(/RecommendationOverflowSheet/);
    expect(cardSource).toMatch(/ellipsis-h/);
  });

  it("does not permanently show Snooze/Dismiss under every card", () => {
    expect(cardSource).not.toMatch(/accessibilityLabel="Snooze recommendation"/);
    expect(cardSource).not.toMatch(/accessibilityLabel="Dismiss recommendation"/);
    expect(cardSource).toMatch(/includeSnoozeDismiss/);
    expect(overflowSource).toMatch(/Snooze|Dismiss|action\.label/);
  });

  it("whole-card tap uses primary destination helper", () => {
    expect(cardSource).toMatch(/onPrimaryPress/);
    expect(cardSource).toMatch(/getRecommendationDestination/);
  });

  it("Survival card has only one primary button", () => {
    expect(survivalSource).toMatch(/Review survival plan/);
    expect(survivalSource).toMatch(/<Button/);
    expect(survivalSource.match(/<Button/g)?.length).toBe(1);
    expect(survivalSource).not.toMatch(/Snooze/);
    expect(survivalSource).not.toMatch(/Dismiss/);
    expect(survivalSource).not.toMatch(/ellipsis/);
  });
});

describe("primary destination mapping", () => {
  it("cash shortfall primary opens ledger when secondary is move_money", () => {
    const rec = cashShortfallRec();
    const dest = getRecommendationDestination(rec);
    expect(dest?.kind).toBe("open_ledger");
    expect(dest?.accountId).toBe(1);
    expect(openLedgerNavigation(1, rec)).toMatchObject({
      pathname: "/(app)/(tabs)/transactions",
      params: {
        account: "1",
        focus: "forecast-risk",
        focusDate: "2026-08-27",
        focusTransactionId: "42",
      },
    });
    const overflow = getRecommendationSecondaryActions(rec, { includeSnoozeDismiss: true });
    expect(overflow.some((a) => a.kind === "transfer")).toBe(true);
  });

  it("explicit PRIMARY move_money opens transfer", () => {
    const dest = getRecommendationDestination({
      ...cashShortfallRec(),
      primary_action_type: "move_money",
      primary_action_label: "Move money",
      secondary_action_type: "navigate",
      secondary_action_label: "Open ledger",
      secondary_action_url: "/transactions?account=1",
    });
    expect(dest?.kind).toBe("transfer");
    expect(dest?.accountId).toBe(1);
  });

  it("credit utilization opens account detail", () => {
    const dest = getRecommendationDestination(utilizationRec());
    expect(dest?.kind).toBe("view_account");
    expect(dest?.accountId).toBe(5);
    expect(accountDetailPath(5)).toBe("/account/5");
  });

  it("goal recommendation opens goal detail", () => {
    const dest = getRecommendationDestination({
      ...utilizationRec(),
      primary_action_label: "Open goal",
      primary_action_url: "/goals/42",
      goal_id: 42,
      account_id: null,
      type: "goal_progress",
    });
    expect(dest).toEqual({
      kind: "navigate",
      label: "Open goal",
      href: "/goal/42",
    });
  });

  it("spending recommendation opens spending limits", () => {
    const dest = getRecommendationDestination({
      ...utilizationRec(),
      id: "spending-limit-1",
      primary_action_label: "View budget",
      primary_action_url: "/spending-goals",
      account_id: null,
      type: "spending_limit",
      impact_type: null,
    });
    expect(dest?.kind).toBe("navigate");
    expect(dest?.href).toBe("/spending-limits");
  });

  it("forecast secondary stays available in overflow when primary is transfer", () => {
    const forecastRec: DashboardRecommendation = {
      ...cashShortfallRec(),
      primary_action_type: "move_money",
      secondary_action_label: "View forecast",
      secondary_action_url: "/timeline?date=2026-08-27",
      secondary_action_type: "navigate",
    };
    const primary = getRecommendationDestination(forecastRec);
    expect(primary?.kind).toBe("transfer");
    const actions = getRecommendationSecondaryActions(forecastRec, { includeSnoozeDismiss: true });
    expect(actions.some((a) => a.kind === "transfer")).toBe(false);
    expect(
      actions.some(
        (a) =>
          a.kind === "navigate" &&
          typeof a.href === "object" &&
          a.href.pathname === "/(app)/(tabs)/calendar"
      )
    ).toBe(true);
    expect(actions.some((a) => a.kind === "snooze")).toBe(true);
    expect(actions.some((a) => a.kind === "dismiss")).toBe(true);
    expect(actions.some((a) => a.kind === "open_ledger")).toBe(true);
  });
});

describe("overflow secondary actions", () => {
  it("does not route utilization health to Payment Planner", () => {
    const secondary = getRecommendationSecondaryActions(utilizationRec(), {
      includeSnoozeDismiss: true,
    });
    expect(secondary.some((a) => a.kind === "payment_planner")).toBe(false);
    expect(secondary.some((a) => a.kind === "open_ledger")).toBe(true);
    expect(secondary.some((a) => a.kind === "view_account")).toBe(false);
    expect(secondary.some((a) => a.kind === "snooze")).toBe(true);
    expect(secondary.some((a) => a.kind === "dismiss")).toBe(true);
  });

  it("routes debt_payoff primary to Payment Planner", () => {
    const rec: DashboardRecommendation = {
      ...utilizationRec(),
      id: "debt-payoff-5",
      type: "debt_payoff",
      primary_action_url: "/credit-cards?account=5",
      primary_action_type: "navigate",
    };
    const dest = getRecommendationDestination(rec);
    expect(dest?.kind).toBe("payment_planner");
    expect(dest?.accountId).toBe(5);
  });

  it("overflow keeps Transfer when cash shortfall primary is open_ledger", () => {
    const primary = getRecommendationDestination(cashShortfallRec());
    expect(primary?.kind).toBe("open_ledger");
    const secondary = getRecommendationSecondaryActions(cashShortfallRec(), {
      includeSnoozeDismiss: true,
    });
    const transfer = secondary.find((a) => a.kind === "transfer");
    expect(transfer).toBeTruthy();
    expect(transferPresetPath(transfer!.transferPreset!)).toEqual({
      pathname: "/transaction/new",
      params: {
        mode: "transfer",
        from: "2",
        to: "1",
        amount: "1406.40",
        date: "2026-08-27",
      },
    });
  });
});

describe("Action Center navigation helpers", () => {
  it("open ledger filters transactions by account", () => {
    expect(openLedgerNavigation(1)).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: {
        account: "1",
        focus: "__none__",
        focusDate: "__none__",
        focusTransactionId: "__none__",
        focusRuleId: "__none__",
        focusEventId: "__none__",
        focusDescription: "__none__",
      },
    });
  });

  it("cash risk open ledger preserves focus context", () => {
    expect(openLedgerNavigation(1, cashShortfallRec())).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: {
        account: "1",
        focus: "forecast-risk",
        focusDate: "2026-08-27",
        focusTransactionId: "42",
        focusRuleId: "__none__",
        focusEventId: "__none__",
        focusDescription: "__none__",
      },
    });
  });

  it("cash risk with date only still focuses the date", () => {
    const rec: DashboardRecommendation = {
      ...cashShortfallRec(),
      transaction_id: undefined,
    };
    expect(openLedgerNavigation(1, rec)).toMatchObject({
      params: {
        account: "1",
        focus: "forecast-risk",
        focusDate: "2026-08-27",
        focusTransactionId: "__none__",
      },
    });
  });

  it("payment planner opens with account param", () => {
    expect(openPaymentPlannerNavigation(5)).toEqual({
      pathname: "/payment-planner",
      params: { account: "5" },
    });
  });

  it("credit utilization does not include payment planner action", () => {
    const actions = recommendationActions(utilizationRec());
    expect(actions.some((a) => a.kind === "payment_planner")).toBe(false);
    expect(actions.some((a) => a.label === "Open ledger")).toBe(true);
  });

  it("cash shortfall transfer opens prefilled transaction form", () => {
    const actions = recommendationActions(cashShortfallRec());
    const transfer = actions.find((a) => a.kind === "transfer");
    expect(transfer).toBeTruthy();
    expect(transferPresetPath(transfer!.transferPreset!)).toEqual({
      pathname: "/transaction/new",
      params: {
        mode: "transfer",
        from: "2",
        to: "1",
        amount: "1406.40",
        date: "2026-08-27",
      },
    });
  });

  it("does not route actions back to action center", () => {
    const actions = recommendationActions(utilizationRec());
    expect(actions.every((a) => a.href !== "/action-center")).toBe(true);
  });

  it("maps recurring primary URL to recurring list", () => {
    const rec: DashboardRecommendation = {
      id: "bill-1",
      severity: "watch",
      title: "Rent",
      why: "Due soon",
      recommended_action: "Review schedule",
      impact_label: null,
      impact_value: null,
      primary_action_label: "View bills",
      primary_action_url: "/recurring",
      primary_action_type: "navigate",
      secondary_action_label: null,
      secondary_action_url: null,
      secondary_action_type: null,
      type: "upcoming_bill",
      account_id: 5,
      impact_type: null,
    };
    expect(resolveRecommendationWebUrl("/recurring", rec)).toBe("/recurring");
    expect(getRecommendationDestination(rec)?.href).toBe("/recurring");
  });

  it("maps spending-goals primary URL to spending limits", () => {
    const rec = {
      ...utilizationRec(),
      id: "spending-limit-1",
      account_id: null,
      type: "spending_limit",
    };
    expect(resolveRecommendationWebUrl("/spending-goals", rec)).toBe("/spending-limits");
  });

  it("maps goal primary URL using goal_id", () => {
    const rec: DashboardRecommendation = {
      ...utilizationRec(),
      primary_action_label: "Open goal",
      primary_action_url: "/goals/42",
      goal_id: 42,
      account_id: null,
    };
    expect(resolveRecommendationWebUrl("/goals/42", rec)).toBe("/goal/42");
  });

  it("maps timeline secondary URL to calendar date", () => {
    const rec: DashboardRecommendation = {
      ...cashShortfallRec(),
      secondary_action_label: "View forecast",
      secondary_action_url: "/timeline?date=2026-08-27",
      secondary_action_type: "navigate",
    };
    expect(resolveRecommendationWebUrl("/timeline?date=2026-08-27", rec)).toEqual({
      pathname: "/(app)/(tabs)/calendar",
      params: { date: "2026-08-27" },
    });
    expect(
      recommendationActions(rec).some(
        (a) =>
          a.kind === "navigate" &&
          typeof a.href === "object" &&
          a.href.pathname === "/(app)/(tabs)/calendar"
      )
    ).toBe(true);
  });
});

describe("Action Center list performance", () => {
  it("does not fetch per-card detail endpoints", () => {
    expect(actionCenterSource).not.toMatch(/getBucketDetail/);
    expect(actionCenterSource).not.toMatch(/getAccount\(/);
  });

  it("lazy-loads account options only when Resolve Risk opens", () => {
    expect(actionCenterSource).toMatch(/useAccountOptions/);
    expect(actionCenterSource).toMatch(/enabled:\s*resolveRiskOpen/);
    expect(actionCenterSource).not.toMatch(/useAccountOptions\(\{\s*householdId\s*\}\)/);
  });
});

describe("Action Center pull refresh and invalidation", () => {
  it("uses explicit pullRefreshing state, not passive isFetching", () => {
    expect(actionCenterSource).toMatch(/pullRefreshing/);
    expect(actionCenterSource).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(actionCenterSource).not.toMatch(/refreshing=\{isFetching/);
  });

  it("snooze/dismiss invalidate recommendations only", () => {
    expect(actionCenterSource).toMatch(/invalidateActionCenterRecommendationQueries/);
    expect(actionCenterSource).toMatch(/onRecommendationPresentationChanged/);
    expect(actionCenterSource).not.toMatch(/invalidateActionCenterFinancialQueries/);
  });
});

describe("Resolve Risk sheet navigation", () => {
  const resolveRiskSource = readFileSync(join(dir, "ResolveRiskSheet.tsx"), "utf8");

  it("routes reduce_utilization to View account, not Payment Planner", () => {
    expect(resolveRiskSource).toMatch(/resolveRiskViewAccountId/);
    expect(resolveRiskSource).toMatch(/View account/);
    expect(resolveRiskSource).toMatch(/accountDetailPath/);
    expect(resolveRiskSource).not.toMatch(/action\.kind === "reduce_utilization"\s*\?\s*action\.account_id/);
  });

  it("Resolve Risk snooze/dismiss use presentation invalidation only", () => {
    expect(resolveRiskSource).toMatch(/onPresentationChanged/);
    expect(resolveRiskSource).not.toMatch(/invalidateActionCenterFinancialQueries/);
  });
});
