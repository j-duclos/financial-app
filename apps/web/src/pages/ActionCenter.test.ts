import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DashboardRecommendation } from "@budget-app/shared";
import {
  recommendationWebPrimaryLabel,
  recommendationWebPrimaryTarget,
} from "@budget-app/shared";

const actionCenterSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ActionCenter.tsx"),
  "utf8"
);
const recommendationsListSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/dashboard/RecommendationsList.tsx"),
  "utf8"
);
const resolveRiskModalSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/resolveRisk/ResolveRiskModal.tsx"),
  "utf8"
);

function utilizationRec(): DashboardRecommendation {
  return {
    id: "utilization-5-10",
    severity: "critical",
    title: "Care Credit",
    why: "Utilization is 22%",
    recommended_action: "Pay $590.96 to reach your 10% target.",
    impact_label: null,
    impact_value: null,
    primary_action_label: "View account",
    primary_action_url: "/credit-cards?account=5",
    primary_action_type: "view_account",
    secondary_action_label: null,
    secondary_action_url: null,
    secondary_action_type: null,
    type: "reduce_utilization",
    account_id: 5,
    impact_type: "credit_utilization",
  };
}

function debtPayoffRec(): DashboardRecommendation {
  return {
    ...utilizationRec(),
    id: "debt-payoff-5",
    type: "debt_payoff",
    primary_action_label: "Payment Planner",
    primary_action_url: "/credit-cards?account=5",
  };
}

describe("Action Center page structure", () => {
  it("adds a Forecast Window selector and keys recommendations by the selected days", () => {
    expect(actionCenterSource).toMatch(/usePageForecastWindow/);
    expect(actionCenterSource).toMatch(/ForecastWindowSelect/);
    expect(actionCenterSource).toMatch(/\["recommendations", "action-center", forecastDays\]/);
    expect(actionCenterSource).toMatch(/getRecommendations\(\{ days: forecastDays \}\)/);
    expect(actionCenterSource).toMatch(/LookingAheadBanner/);
    expect(actionCenterSource).toMatch(/isLookingAheadVisible/);
    expect(actionCenterSource).toMatch(/useExtendedCashRisk/);
    expect(actionCenterSource).not.toMatch(/\["extended-cash-risk", forecastDays\]/);
    expect(actionCenterSource).toMatch(/forecastDays=\{forecastDays\}/);
    expect(actionCenterSource).not.toMatch(/updateProfile/);
    expect(actionCenterSource).not.toMatch(/DEFAULT_PASSIVE_FORECAST_DAYS/);
  });

  it("loads recommendations from the dedicated endpoint, not the full dashboard summary", () => {
    expect(actionCenterSource).toMatch(/getRecommendations/);
    expect(actionCenterSource).not.toMatch(/getDashboardSummary/);
    expect(actionCenterSource).not.toMatch(/getDashboardSummaryFast/);
    expect(actionCenterSource).not.toMatch(/getDashboardDetails/);
  });

  it("lazy-loads accounts when Resolve Risk or transfer modal opens", () => {
    expect(actionCenterSource).toMatch(/listAccounts/);
    expect(actionCenterSource).toMatch(/needsAccountOptions/);
    expect(actionCenterSource).toMatch(/enabled:\s*needsAccountOptions/);
  });

  it("builds grouped view from the same recommendation collection", () => {
    expect(actionCenterSource).toMatch(/buildActionCenterView/);
    expect(actionCenterSource).toMatch(/SurvivalModeBanner/);
    expect(actionCenterSource).toMatch(/view\.summaryText/);
    expect(actionCenterSource).toMatch(/view\.groups/);
    expect(actionCenterSource).not.toMatch(/activeCount/);
  });

  it("preserves snooze and dismiss wiring for normal recommendations, not survival", () => {
    expect(actionCenterSource).toMatch(/snoozeRecommendation/);
    expect(actionCenterSource).toMatch(/dismissRecommendation/);
    expect(actionCenterSource).toMatch(/unsnoozeRecommendation/);
    expect(actionCenterSource).toMatch(/restoreRecommendation/);
    const bannerCall = actionCenterSource.slice(
      actionCenterSource.indexOf("{view.survival &&"),
      actionCenterSource.indexOf("RecommendationsList")
    );
    expect(bannerCall).not.toMatch(/onSnooze/);
    expect(bannerCall).not.toMatch(/onDismiss/);
  });

  it("snooze/dismiss do not invalidate financial caches", () => {
    expect(actionCenterSource).toMatch(/onSnoozed=\{\(\) => \{\s*bumpRefresh\(\)/);
    expect(actionCenterSource).toMatch(/invalidateFinancialQueries/);
  });
});

describe("Web recommendation navigation", () => {
  it("reduce_utilization opens account detail despite legacy credit-cards URL", () => {
    expect(recommendationWebPrimaryTarget(utilizationRec())).toEqual({
      to: "/accounts?account=5",
    });
    expect(recommendationWebPrimaryLabel(utilizationRec())).toBe("View account");
  });

  it("debt_payoff opens payment planner", () => {
    expect(recommendationWebPrimaryTarget(debtPayoffRec())).toEqual({
      to: "/credit-cards?account=5",
    });
  });

  it("RecommendationsList uses type-driven primary targets", () => {
    expect(recommendationsListSource).toMatch(/recommendationWebPrimaryTarget/);
    expect(recommendationsListSource).toMatch(/recommendationWebPrimaryLabel/);
    expect(recommendationsListSource).not.toMatch(/attentionLedgerState/);
  });
});

describe("Web Resolve Risk modal", () => {
  it("routes reduce_utilization to View account without legacy CTA duplicate", () => {
    expect(resolveRiskModalSource).toMatch(/resolveRiskViewAccountUrl/);
    expect(resolveRiskModalSource).toMatch(/View account/);
    expect(resolveRiskModalSource).toMatch(
      /!transferPreset && !viewAccountUrl && !plannerUrl && action\.primary_action_url/
    );
  });

  it("exposes Payment Planner for debt_payoff without requiring legacy URL CTA", () => {
    expect(resolveRiskModalSource).toMatch(/resolveRiskPlannerUrl/);
    expect(resolveRiskModalSource).toMatch(/Payment Planner/);
  });
});

describe("production hard-coded utilization cleanup", () => {
  it("does not keep allegedly-wrong utilization targets in shared production helpers", () => {
    const displaySource = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../packages/shared/src/recommendationDisplay.ts"
      ),
      "utf8"
    );
    expect(displaySource).not.toMatch(/hardcodedWrong/);
    expect(displaySource).not.toMatch(/recommendationUtilizationUsesConfiguredTarget/);
    expect(displaySource).not.toMatch(/\["30%",\s*"70%",\s*"75%"\]/);
  });
});
