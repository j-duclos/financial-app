import { describe, expect, it } from "vitest";
import type { DashboardRecommendation } from "@budget-app/shared";
import {
  insightToRecommendation,
  OPEN_PAYOFF_PLANNER_LABEL,
  recommendationActionLabel,
  recommendationImpactLine,
  recommendationPayoffPlannerUrl,
  recommendationTransferPreset,
  isHealthyRecommendationSeverity,
  recommendationsForDisplay,
  recommendationsForActionCenter,
  compareRecommendationsByPriority,
} from "./recommendationDisplay";

describe("recommendationDisplay", () => {
  it("excludes healthy and positive severities from display list", () => {
    const items = recommendationsForDisplay(
      [
        {
          id: "ok",
          severity: "warning",
          title: "Watch",
          why: "x",
          recommended_action: null,
          impact_label: null,
          impact_value: null,
          primary_action_label: null,
          primary_action_url: null,
          primary_action_type: null,
          secondary_action_label: null,
          secondary_action_url: null,
          secondary_action_type: null,
        },
        {
          id: "pos",
          severity: "positive",
          title: "All good",
          why: "y",
          recommended_action: null,
          impact_label: null,
          impact_value: null,
          primary_action_label: null,
          primary_action_url: null,
          primary_action_type: null,
          secondary_action_label: null,
          secondary_action_url: null,
          secondary_action_type: null,
        },
      ],
      undefined,
      new Set(),
      new Set()
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("ok");
    expect(isHealthyRecommendationSeverity("positive")).toBe(true);
    expect(isHealthyRecommendationSeverity("healthy")).toBe(true);
  });

  it("maps insights to recommendations when API omits recommendations", () => {
    const items = recommendationsForDisplay(
      undefined,
      [
        {
          id: "test",
          severity: "warning",
          title: "High utilization",
          message: "Card is over target",
          metric_label: "Amount",
          metric_value: "500",
          action_label: "View account",
          action_url: "/accounts?account=1",
          secondary_action_label: null,
          secondary_action_url: null,
        },
      ],
      new Set(),
      new Set()
    );
    expect(items).toHaveLength(1);
    expect(items[0].why).toBe("Card is over target");
  });

  it("formats impact line", () => {
    const rec: DashboardRecommendation = {
      ...insightToRecommendation({
        id: "x",
        severity: "critical",
        title: "T",
        message: "why",
        metric_label: "Amount",
        metric_value: "42.50",
        action_label: null,
        action_url: null,
        secondary_action_label: null,
        secondary_action_url: null,
      }),
    };
    expect(recommendationImpactLine(rec)).toMatch(/42\.50/);
  });

  it("builds transfer modal preset from move_money recommendation", () => {
    const preset = recommendationTransferPreset({
      id: "move-money-2-1",
      severity: "critical",
      title: "Move $562.88 from Savings to Main",
      why: "Projected balance drops below zero",
      recommended_action: "Move funds",
      impact_label: "Transfer amount",
      impact_value: "562.88",
      recommended_amount: "562.88",
      primary_action_label: "Execute transfer",
      primary_action_url: "/transactions?transfer=1&from=2&to=1",
      primary_action_type: "move_money",
      secondary_action_label: null,
      secondary_action_url: null,
      secondary_action_type: null,
      account_id: 1,
      related_account_id: 2,
    });
    expect(preset).toEqual({
      accountId: 1,
      mode: "transfer",
      transferToAccountId: 1,
      transferFromAccountId: 2,
      defaultAmount: "562.88",
    });
  });

  it("maps timeline action labels to open calendar", () => {
    expect(recommendationActionLabel("Timeline")).toBe("Open calendar");
    expect(recommendationActionLabel("Open timeline")).toBe("Open calendar");
    expect(recommendationActionLabel("View Timeline")).toBe("Open calendar");
    expect(recommendationActionLabel("Calendar")).toBe("Open calendar");
    expect(recommendationActionLabel("View calendar")).toBe("Open calendar");
    expect(recommendationActionLabel("Debt payoff")).toBe("Payment Planner");
    expect(recommendationActionLabel("Payment planner")).toBe("Payment Planner");
    expect(recommendationActionLabel("Payoff planner")).toBe("Payment Planner");
    expect(recommendationActionLabel("Make payment")).toBe("Payment Planner");
  });

  it("maps spending limit CTAs to view spending limits", () => {
    expect(recommendationActionLabel("View goals", "/spending-goals")).toBe("View spending limits");
    expect(recommendationActionLabel("Spending goals", "/spending-goals")).toBe("View spending limits");
    expect(recommendationActionLabel("View goals", "/goals")).toBe("View goals");
  });

  it("skips extra planner button when primary or secondary already opens planner", () => {
    const base = {
      id: "debt-1",
      severity: "warning" as const,
      title: "Debt payoff opportunity",
      why: "Extra payments save interest",
      recommended_action: null,
      primary_action_type: "navigate" as const,
      secondary_action_label: null,
      secondary_action_url: null,
      secondary_action_type: null,
    };
    expect(
      recommendationPayoffPlannerUrl({
        ...base,
        primary_action_label: "Payoff planner",
        primary_action_url: "/credit-cards",
      })
    ).toBeNull();
    expect(
      recommendationPayoffPlannerUrl({
        ...base,
        title: "High utilization on Venture",
        why: "Utilization above target",
        primary_action_label: "Open ledger",
        primary_action_url: "/transactions?account=3",
        secondary_action_label: null,
        secondary_action_url: null,
      })
    ).toBe("/credit-cards?account=3");
  });

  it("prefers projected_improvement for impact line", () => {
    const rec: DashboardRecommendation = {
      id: "x",
      severity: "warning",
      title: "T",
      why: "W",
      recommended_action: null,
      impact_label: "Amount",
      impact_value: "10",
      projected_improvement: "Avoids overdraft and restores buffer.",
      primary_action_label: null,
      primary_action_url: null,
      primary_action_type: null,
      secondary_action_label: null,
      secondary_action_url: null,
      secondary_action_type: null,
    };
    expect(recommendationImpactLine(rec)).toBe("Avoids overdraft and restores buffer.");
  });

  it("action center includes snoozed and dismissed with state", () => {
    const rec: DashboardRecommendation = {
      id: "snoozed-1",
      severity: "warning",
      title: "T",
      why: "W",
      recommended_action: null,
      impact_label: null,
      impact_value: null,
      primary_action_label: null,
      primary_action_url: null,
      primary_action_type: null,
      secondary_action_label: null,
      secondary_action_url: null,
      secondary_action_type: null,
    };
    const entries = recommendationsForActionCenter([rec], undefined, new Set(), new Set(["snoozed-1"]));
    expect(entries).toHaveLength(1);
    expect(entries[0].displayState).toBe("snoozed");
  });

  it("sorts critical before watch", () => {
    const critical: DashboardRecommendation = {
      id: "c",
      severity: "critical",
      title: "C",
      why: "x",
      recommended_action: null,
      impact_label: null,
      impact_value: null,
      primary_action_label: null,
      primary_action_url: null,
      primary_action_type: null,
      secondary_action_label: null,
      secondary_action_url: null,
      secondary_action_type: null,
      priority_score: 1,
    };
    const watch: DashboardRecommendation = {
      ...critical,
      id: "w",
      severity: "watch",
      priority_score: 99,
    };
    expect(compareRecommendationsByPriority(critical, watch)).toBeLessThan(0);
  });
});
