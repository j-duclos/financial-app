import { describe, expect, it } from "vitest";
import type { DashboardRecommendation } from "@budget-app/shared";
import {
  actionCenterSummaryText,
  buildActionCenterView,
  consolidateRecommendationEntries,
  recommendationCardCopy,
  recommendationStrategyKey,
} from "./actionCenterView";
import {
  recommendationPrimaryCtaLabel,
  recommendationSecondaryCtaLabel,
  sanitizeRecommendationCopy,
  type RecommendationListEntry,
} from "./recommendationDisplay";

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
    primary_action_url: "/credit-cards",
    primary_action_type: "navigate",
    secondary_action_label: null,
    secondary_action_url: null,
    secondary_action_type: null,
    ...overrides,
  };
}

function entry(
  item: DashboardRecommendation,
  displayState: RecommendationListEntry["displayState"] = "active"
): RecommendationListEntry {
  return { rec: item, displayState };
}

describe("actionCenterView grouping", () => {
  it("groups by urgency and omits empty groups", () => {
    const view = buildActionCenterView([
      entry(rec({ id: "c1", title: "Critical move", severity: "critical", type: "move_money" })),
      entry(rec({ id: "a1", title: "At risk util", severity: "warning", type: "reduce_utilization" })),
      entry(rec({ id: "a2", title: "At risk debt", severity: "warning", type: "debt_payoff" })),
      entry(rec({ id: "w1", title: "Watch goal", severity: "info", type: "increase_goal_contribution" })),
      entry(rec({ id: "w2", title: "Watch spend", severity: "info", type: "reduce_spending" })),
      entry(rec({ id: "w3", title: "Watch savor", severity: "info", type: "reduce_utilization" })),
    ]);
    expect(view.groups.map((g) => g.key)).toEqual(["critical", "at_risk", "watch"]);
    expect(view.groups.map((g) => g.count)).toEqual([1, 2, 3]);
    expect(view.groups.find((g) => g.key === "critical")?.label).toBe("CRITICAL");
    expect(view.summary).toEqual({ total: 6, critical: 1, atRisk: 2, watch: 3 });
    expect(view.summaryText).toBe("6 actions · 1 critical · 2 at risk · 3 watch");
  });

  it("omits empty severity groups", () => {
    const view = buildActionCenterView([
      entry(rec({ id: "w1", title: "Watch only", severity: "info" })),
    ]);
    expect(view.groups.map((g) => g.key)).toEqual(["watch"]);
    expect(view.summaryText).toBe("1 action · 1 watch");
  });

  it("excludes survival mode from action counts and groups", () => {
    const view = buildActionCenterView([
      entry(
        rec({
          id: "survival-mode",
          type: "survival_mode",
          title: "Survival mode recommended",
          severity: "critical",
          why: "Multiple accounts are projected to fall below zero.",
        })
      ),
      entry(rec({ id: "c1", title: "Move money", severity: "critical", type: "move_money" })),
      entry(rec({ id: "w1", title: "Watch", severity: "info" })),
    ]);
    expect(view.survival?.rec.id).toBe("survival-mode");
    expect(view.groups.flatMap((g) => g.entries.map((e) => e.rec.id))).not.toContain("survival-mode");
    expect(view.summary.total).toBe(2);
    expect(view.summary.critical).toBe(1);
    expect(view.summaryText).toBe("2 actions · 1 critical · 1 watch");
  });

  it("keeps snoozed and dismissed actions out of summary but still visible", () => {
    const view = buildActionCenterView([
      entry(rec({ id: "c1", title: "Critical", severity: "critical" }), "snoozed"),
      entry(rec({ id: "w1", title: "Watch", severity: "info" })),
    ]);
    expect(view.summary.total).toBe(1);
    expect(view.groups.map((g) => g.key)).toEqual(["watch"]);
    expect(view.inactive.map((e) => e.rec.id)).toEqual(["c1"]);
  });

  it("keeps snoozed survival out of the banner and out of action counts", () => {
    const view = buildActionCenterView([
      entry(
        rec({
          id: "survival-mode",
          type: "survival_mode",
          title: "Survival mode recommended",
          severity: "critical",
        }),
        "snoozed"
      ),
      entry(rec({ id: "w1", title: "Watch", severity: "info" })),
    ]);
    expect(view.survival).toBeNull();
    expect(view.inactive.map((e) => e.rec.id)).toContain("survival-mode");
    expect(view.summary.total).toBe(1);
  });

  it("summary matches rendered active cards after consolidation", () => {
    const view = buildActionCenterView([
      entry(
        rec({
          id: "debt-payoff-household",
          type: "debt_payoff",
          title: "Debt payoff opportunity",
          why: "Pay Care Credit first to attack 32.99% APR debt.",
          severity: "warning",
        })
      ),
      entry(
        rec({
          id: "debt-payoff-household",
          type: "debt_payoff",
          title: "Debt payoff opportunity",
          why: "This plan saves about $3289.71 vs minimum payments only.",
          projected_improvement: "This plan saves about $3289.71 vs minimum payments only.",
          severity: "warning",
        })
      ),
      entry(rec({ id: "u1", title: "Pay toward Venture", type: "reduce_utilization", severity: "warning" })),
    ]);
    const rendered = view.groups.flatMap((g) => g.entries);
    expect(rendered).toHaveLength(2);
    expect(view.summary.total).toBe(rendered.length);
    expect(view.summary.atRisk).toBe(2);
  });

  it("orders within a group by priority then date then id", () => {
    const view = buildActionCenterView([
      entry(
        rec({
          id: "b",
          title: "Later",
          severity: "critical",
          priority_score: 10,
          recommended_date: "2026-08-22",
        })
      ),
      entry(
        rec({
          id: "a",
          title: "Sooner",
          severity: "critical",
          priority_score: 10,
          recommended_date: "2026-08-18",
        })
      ),
    ]);
    expect(view.groups[0]?.entries.map((e) => e.rec.id)).toEqual(["a", "b"]);
  });
});

describe("debt payoff consolidation", () => {
  it("merges overlapping household payoff recs and keeps APR + savings copy", () => {
    const merged = consolidateRecommendationEntries([
      entry(
        rec({
          id: "debt-payoff-household",
          type: "debt_payoff",
          title: "Debt payoff opportunity",
          why: "Pay Care Credit first to attack 32.99% APR debt.",
          priority_score: 800,
        })
      ),
      entry(
        rec({
          id: "debt-payoff-2",
          type: "debt_payoff",
          title: "Debt payoff opportunity",
          why: "This plan saves about $3289.71 vs minimum payments only.",
          projected_improvement: "This plan saves about $3289.71 vs minimum payments only.",
          priority_score: 500,
        })
      ),
    ]);
    expect(merged).toHaveLength(1);
    expect(recommendationStrategyKey(merged[0]!.rec)).toBe("debt_payoff:household");
    expect(merged[0]!.rec.why).toMatch(/APR/);
    expect(merged[0]!.rec.projected_improvement).toMatch(/3289\.71/);
  });

  it("does not merge independent recommendations", () => {
    const merged = consolidateRecommendationEntries([
      entry(
        rec({
          id: "utilization-3-70",
          type: "reduce_utilization",
          title: "Pay $97.92 toward Savor",
          account_id: 3,
        })
      ),
      entry(
        rec({
          id: "debt-payoff-9",
          type: "debt_payoff",
          title: "Prioritize Care Credit payoff",
          account_id: 9,
        })
      ),
      entry(
        rec({
          id: "utilization-9-70",
          type: "reduce_utilization",
          title: "Pay $200 toward Care Credit",
          account_id: 9,
        })
      ),
      entry(
        rec({
          id: "move-money-2-1",
          type: "move_money",
          title: "Move $50 from Savings to Main",
          account_id: 1,
        })
      ),
    ]);
    expect(merged.map((e) => e.rec.id)).toEqual([
      "utilization-3-70",
      "debt-payoff-9",
      "utilization-9-70",
      "move-money-2-1",
    ]);
  });
});

describe("card copy", () => {
  it("strips placeholder language", () => {
    expect(sanitizeRecommendationCopy("Brings utilization toward 70% (score improvement placeholder).")).toBe(
      "Brings utilization toward 70%"
    );
    const copy = recommendationCardCopy(
      rec({
        id: "u",
        title: "Pay $851.11 toward Venture",
        why: "Venture is at 98% utilization. (score improvement placeholder)",
        recommended_action: "Pay $851.11 to bring utilization below 70%.",
      })
    );
    expect(copy.condition).toBe("Venture is at 98% utilization.");
    expect(copy.action).toBe("Pay $851.11 to bring utilization below 70%.");
    expect(copy.condition.toLowerCase()).not.toMatch(/placeholder/);
  });

  it("shows transfer amount and date without repeating WHY/WHAT/IMPACT labels", () => {
    const item = rec({
      id: "move-money-2-1",
      type: "move_money",
      title: "Move $1736.02 from Savings to Main",
      why: "Main is projected to fall below $0 on Aug 20.",
      recommended_action: "Transfer $1736.02 before Aug 18 to avoid the shortfall.",
      recommended_amount: "1736.02",
      recommended_date: "2026-08-18",
      primary_action_label: "Execute transfer",
      primary_action_type: "move_money",
      secondary_action_label: "Open calendar",
      secondary_action_url: "/timeline?date=2026-08-18",
      secondary_action_type: "navigate",
    });
    const copy = recommendationCardCopy(item);
    expect(copy.condition).toBe("Main is projected to fall below $0 on Aug 20.");
    expect(copy.action).toBe("Transfer $1736.02 before Aug 18 to avoid the shortfall.");
    expect(recommendationPrimaryCtaLabel(item)).toBe("Transfer $1736.02");
    expect(recommendationSecondaryCtaLabel(item)).toBe("View forecast");
  });

  it("formats summary from the same counts as groups", () => {
    expect(actionCenterSummaryText({ total: 0, critical: 0, atRisk: 0, watch: 0 })).toBe("0 actions");
    expect(actionCenterSummaryText({ total: 6, critical: 1, atRisk: 2, watch: 3 })).toBe(
      "6 actions · 1 critical · 2 at risk · 3 watch"
    );
  });
});
