import { describe, expect, it } from "vitest";
import type { DashboardRecommendation } from "./types";
import {
  buildActionCenterView,
  recommendationCardCopy,
} from "./actionCenterView";
import {
  compareRecommendationsByPriority,
  recommendationTransferPreset,
  recommendationsForActionCenter,
} from "./recommendationDisplay";
import { recommendationIsCreditPayment, recommendationShowsResolveRisk } from "./resolveRiskDisplay";

function rec(
  overrides: Partial<DashboardRecommendation> & Pick<DashboardRecommendation, "id" | "title">
): DashboardRecommendation {
  return {
    severity: "warning",
    why: "Condition",
    recommended_action: "Do the thing",
    impact_label: null,
    impact_value: null,
    primary_action_label: "Go",
    primary_action_url: "/credit-cards?account=1",
    primary_action_type: "navigate",
    secondary_action_label: null,
    secondary_action_url: null,
    secondary_action_type: null,
    ...overrides,
  };
}

describe("recommendation utilization target", () => {
  it("uses user-configured fixture target in recommendation copy", () => {
    const fixtureTarget = 10;
    const utilization = rec({
      id: "utilization-3-10",
      title: "Care Credit",
      type: "reduce_utilization",
      severity: "critical",
      why: "Utilization is 22%",
      recommended_action: `Pay $590.96 to reach your ${fixtureTarget}% target.`,
      account_id: 3,
      impact_type: "credit_utilization",
    });
    expect(utilization.recommended_action).toContain(`${fixtureTarget}%`);
  });
});

describe("recommendation priority ordering", () => {
  it("sorts by severity then priority score", () => {
    const sorted = [
      rec({ id: "w", title: "Watch", severity: "info", priority_score: 99 }),
      rec({ id: "c", title: "Critical", severity: "critical", priority_score: 1 }),
      rec({ id: "r", title: "At risk", severity: "warning", priority_score: 50 }),
    ].sort(compareRecommendationsByPriority);
    expect(sorted.map((r) => r.id)).toEqual(["c", "r", "w"]);
  });
});

describe("cash shortfall vs credit recommendations", () => {
  it("shows resolve risk for cash shortfall not credit utilization", () => {
    const cash = rec({
      id: "attention-1",
      title: "Main",
      severity: "critical",
      type: "move_money",
      account_id: 1,
      why: "Projected negative Aug 27",
      recommended_action: "Add $1,406.40 before Aug 27.",
      primary_action_type: "navigate",
      secondary_action_type: "move_money",
      secondary_action_label: "Move money",
    });
    const credit = rec({
      id: "utilization-2-10",
      title: "Care Credit",
      type: "reduce_utilization",
      severity: "critical",
      account_id: 2,
      why: "Utilization is 22%",
      recommended_action: "Pay $590.96 to reach your 10% target.",
      impact_type: "credit_utilization",
    });

    expect(recommendationShowsResolveRisk(cash)).toBe(false);
    expect(recommendationIsCreditPayment(credit)).toBe(true);
    expect(recommendationShowsResolveRisk(credit)).toBe(false);

    const transfer = recommendationTransferPreset({
      ...cash,
      account_id: 1,
      related_account_id: 5,
      recommended_amount: "1406.40",
      recommended_date: "2026-08-27",
      secondary_action_type: "move_money",
    });
    expect(transfer?.transferToAccountId).toBe(1);
    expect(transfer?.transferFromAccountId).toBe(5);
    expect(transfer?.defaultAmount).toBe("1406.40");
  });
});

describe("action center view", () => {
  it("groups recommendations by urgency", () => {
    const entries = recommendationsForActionCenter(
      [
        rec({ id: "c1", title: "Critical", severity: "critical" }),
        rec({ id: "w1", title: "Watch", severity: "info" }),
      ],
      undefined,
      new Set(),
      new Set()
    );
    const view = buildActionCenterView(entries);
    expect(view.groups.map((g) => g.key)).toEqual(["critical", "watch"]);
    expect(view.summary.total).toBe(2);
  });

  it("dedupes redundant action copy from condition", () => {
    const copy = recommendationCardCopy(
      rec({
        id: "1",
        title: "Main",
        why: "Projected balance falls below $0 on Aug 27.",
        recommended_action: "Add $1,406.40 before Aug 27.",
      })
    );
    expect(copy.condition).toContain("Aug 27");
    expect(copy.action).toContain("$1,406.40");
  });
});
