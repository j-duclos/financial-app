import { describe, expect, it } from "vitest";
import { planItemChangeImpactLine } from "./scenarioPlainLanguage";
import {
  formatComparisonValue,
  timelineUrlWithScenario,
  COMPARISON_METRIC_LABELS,
  deriveScenarioDecision,
  deriveScenarioResult,
  deriveImpactLabel,
  deriveCostImpactLines,
  buildPlanSummary,
  buildBeforeAfterRow,
  buildPlanSummaryHeadline,
  buildPlanSummaryHighlights,
  buildPlanSummaryImpactLines,
  buildDetailedImpactRows,
  formatDetailedImpactChange,
  formatRiskDaysPlainEnglish,
  formatRiskDaysImpactLine,
  formatMakeThisSafeLine,
  formatFirstProblemDayPlainEnglish,
  formatLowestBalanceOutlookChange,
  DETAILED_IMPACT_NO_CHANGE,
  deriveWhyExplanation,
  derivePlanSummaryResult,
  shouldShowFirstProblemDaySummary,
  shouldShowOptionalDetailMetric,
  shouldShowRiskDaysSummary,
  recurringCostFromGroup,
  horizonToMonths,
} from "./scenarioComparisonDisplay";
import type { ScenarioComparisonResponse } from "@budget-app/shared";
import { planItemChangeImpactLine as planItemChangeImpactLineFn } from "./scenarioPlainLanguage";

describe("scenarioComparisonDisplay", () => {
  it("formats currency metrics", () => {
    expect(formatComparisonValue("ending_cash", "1234.5")).toMatch(/\$1,234\.50/);
  });

  it("formats risk days as plain number", () => {
    expect(formatComparisonValue("risk_days", 4)).toBe("4");
  });

  it("builds timeline URL with scenario", () => {
    expect(timelineUrlWithScenario(7, "12m")).toBe("/timeline?scenario_id=7&horizon=12m");
    expect(timelineUrlWithScenario(3)).toBe("/timeline?scenario_id=3");
  });

  it("has labels for core metrics", () => {
    expect(COMPARISON_METRIC_LABELS.lowest_projected_balance).toBeTruthy();
    expect(COMPARISON_METRIC_LABELS.total_income).toBeTruthy();
  });

  it("derives better verdict when risk days decrease", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 2, scenario: 1, delta: "-1" },
        lowest_projected_balance: { base: "0.59", scenario: "4.15", delta: "3.56" },
        first_risk_date: { base: "2026-06-04", scenario: null, delta: null },
        total_expenses: { base: "1000", scenario: "1300", delta: "300" },
      },
      risk_explanation: {
        is_risky: false,
        base_lowest_balance: "0.59",
        scenario_lowest_balance: "4.15",
        first_problem_date: null,
      },
    } as ScenarioComparisonResponse;

    const decision = deriveScenarioDecision(comparison, [
      {
        id: "ev-1",
        title: "HBO",
        costLabel: "$25 one-time expense",
        actionLabel: "Added HBO",
        detailLabel: "-$25.00 on May 30",
        text: "",
        sortDate: "2026-05-30",
        kind: "event",
        sourceId: 1,
        dateLabel: "May 30",
        accountLabel: "Paid from Main",
        changePhrase: "This adds HBO for $25 on May 30.",
        whyBullet: "HBO costs $25.00 on May 30.",
        impactKind: "one_time_expense",
        impactAmount: 25,
      },
    ]);
    expect(decision?.verdict).toBe("better");
    expect(decision?.headline).toContain("improves");
    expect(decision?.recommendation).toContain("improves");
  });

  it("derives risky verdict when balance goes negative", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 0, scenario: 3, delta: "3" },
        lowest_projected_balance: { base: "0.59", scenario: "-200.15", delta: "-200.74" },
        first_risk_date: { base: null, scenario: "2026-11-06", delta: null },
        total_expenses: { base: "1000", scenario: "1650", delta: "650" },
      },
      forecast_change_groups: [
        {
          event: "Cursor",
          account_id: 1,
          account_name: "Main",
          rule_id: 10,
          frequency: "monthly",
          occurrence_count: 12,
          delta_per_occurrence: "-9.48",
          total_delta: "-113.76",
          first_date: "2026-05-29",
          effect_kind: "cash_flow",
          base_amount: "-65.52",
          scenario_amount: "-75.00",
        },
      ],
      risk_explanation: {
        is_risky: true,
        first_problem_date: "2026-11-06",
        first_problem_account_id: 1,
        first_problem_account_name: "Main",
        triggering_event: "Cursor",
        base_lowest_balance: "0.59",
        base_lowest_balance_date: "2026-10-15",
        scenario_lowest_balance: "-200.15",
        scenario_lowest_balance_date: "2026-11-06",
        shortfall_amount: "200.15",
        amount_needed_to_stay_safe: "200.15",
      },
    } as ScenarioComparisonResponse;

    const decision = deriveScenarioDecision(comparison, []);
    expect(decision?.verdict).toBe("risky");
    expect(decision?.headline).toContain("cash problem");
    expect(decision?.recommendation).toContain("200.15");
    expect(decision?.recommendation).toContain("11-06-26");
    expect(deriveImpactLabel(comparison)).toBe("Worse");
  });

  it("derives safe verdict for manageable change", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 0, scenario: 0, delta: "0" },
        lowest_projected_balance: { base: "500", scenario: "475", delta: "-25" },
        first_risk_date: { base: null, scenario: null, delta: null },
        total_expenses: { base: "1000", scenario: "1025", delta: "25" },
      },
      risk_explanation: {
        is_risky: false,
        base_lowest_balance: "500",
        scenario_lowest_balance: "475",
        first_problem_date: null,
      },
    } as ScenarioComparisonResponse;

    const decision = deriveScenarioDecision(comparison, []);
    expect(decision?.verdict).toBe("safe");
    expect(decision?.verdictLabel).toBe("GOOD IDEA");
  });

  it("computes recurring cost from traceable group delta", () => {
    const cost = recurringCostFromGroup({
      event: "Cursor",
      account_id: 1,
      account_name: "Main",
      rule_id: 10,
      frequency: "monthly",
      occurrence_count: 12,
      delta_per_occurrence: "-9.48",
      total_delta: "-113.76",
      first_date: "2026-05-29",
      effect_kind: "cash_flow",
      base_amount: "-65.52",
      scenario_amount: "-75.00",
    });
    expect(cost?.monthly).toBeCloseTo(9.48);
    expect(cost?.annual).toBeCloseTo(113.76);
    expect(cost?.label).toBe("increase");
  });

  it("uses expense change labels from forecast groups not aggregate totals", () => {
    const comparison = {
      metrics: {
        total_expenses: { base: "1000", scenario: "800", delta: "-200" },
      },
      forecast_change_groups: [
        {
          event: "Cursor",
          account_id: 1,
          account_name: "Main",
          rule_id: 10,
          frequency: "monthly",
          occurrence_count: 12,
          delta_per_occurrence: "-9.48",
          total_delta: "-113.76",
          first_date: "2026-05-29",
          effect_kind: "cash_flow",
          base_amount: "-65.52",
          scenario_amount: "-75.00",
        },
      ],
    } as ScenarioComparisonResponse;

    const lines = deriveCostImpactLines([], comparison, 12);
    expect(lines[0]?.label).toBe("Expense change");
    expect(lines[0]?.lines[0]).toContain("+$9.48");
    expect(lines[0]?.lines[0]).not.toContain("reduced");
  });

  it("builds plan summary with SAFE/RISKY result", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 1, scenario: 32, delta: "31" },
        lowest_projected_balance: { base: "0.59", scenario: "-200.15", delta: "-200.74" },
        first_risk_date: { base: null, scenario: "2026-11-06", delta: null },
      },
      risk_explanation: {
        is_risky: true,
        first_problem_date: "2026-11-06",
        first_problem_account_name: "Chase",
        base_lowest_balance: "0.59",
        scenario_lowest_balance: "-200.15",
        amount_needed_to_stay_safe: "200.15",
      },
    } as ScenarioComparisonResponse;

    const planItems = [
      {
        id: "ov-1",
        title: "HBO",
        costLabel: "+$25/month",
        actionLabel: "Added HBO subscription",
        detailLabel: "+$25/month",
        text: "",
        sortDate: "2026-05-01",
        kind: "override" as const,
        sourceId: 1,
        dateLabel: null,
        accountLabel: null,
        changePhrase: "",
        whyBullet: "HBO adds $25/month.",
        impactKind: "recurring" as const,
        impactAmount: 25,
      },
    ];

    const summary = buildPlanSummary(comparison, planItems);
    expect(summary?.result).toBe("RISKY");
    expect(summary?.lowestBalance).toContain("0.59");
    expect(summary?.lowestBalance).toContain("-$200.15");
    expect(summary?.recommendation).toContain("200.15");

    const why = deriveWhyExplanation(comparison, planItems);
    expect(why?.heading).toBe("Why does this create a problem?");
    expect(why?.bullets[0]).toContain("HBO");
    expect(why?.bullets.some((b) => b.includes("Chase"))).toBe(true);
  });

  it("maps verdicts to plan summary results", () => {
    expect(derivePlanSummaryResult("risky")).toBe("RISKY");
    expect(derivePlanSummaryResult("safe")).toBe("SAFE");
    expect(derivePlanSummaryResult("neutral")).toBe("NO CHANGE");
  });

  it("explains credit-only changes without blaming checking accounts", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 0, scenario: 0, delta: "0" },
        lowest_projected_balance: { base: "0.59", scenario: "0.59", delta: "0" },
        first_risk_date: { base: null, scenario: null, delta: null },
        credit_debt_after_horizon: { base: "500", scenario: "557", delta: "57" },
      },
      risk_explanation: {
        is_risky: false,
        impact_scope: "credit_only",
        cash_lowest_unchanged: true,
        base_lowest_balance: "0.59",
        scenario_lowest_balance: "0.59",
        first_problem_date: null,
        traceable_credit_charge_delta: "56.88",
        traceable_per_occurrence: "9.48",
        traceable_occurrence_count: 6,
      },
    } as ScenarioComparisonResponse;

    const planItems = [
      {
        id: "ov-1",
        title: "Cursor",
        costLabel: "+$9.48/month",
        actionLabel: "Increased Cursor",
        detailLabel: "+$9.48/month",
        text: "",
        sortDate: "2026-05-01",
        kind: "override" as const,
        sourceId: 1,
        dateLabel: null,
        accountLabel: null,
        changePhrase: "",
        whyBullet: "Cursor adds $9.48/month.",
        impactKind: "recurring" as const,
        impactAmount: 9.48,
      },
    ];

    const why = deriveWhyExplanation(comparison, planItems);

    expect(why?.heading).toBe("What this changes");
    expect(why?.bullets.some((b) => b.includes("$9.48") && b.includes("6"))).toBe(true);
    expect(why?.bullets.some((b) => b.includes("$56.88"))).toBe(true);
    expect(why?.bullets.some((b) => b.includes("checking"))).toBe(true);
    expect(why?.bullets.some((b) => b.includes("Chase"))).toBe(false);
    expect(buildPlanSummary(comparison, planItems)?.result).toBe("SAFE");
    const summary = buildPlanSummary(comparison, planItems);
    expect(summary?.showMetricsFooter).toBe(false);
    expect(summary?.footerLines).toEqual([]);
    expect(buildBeforeAfterRow(comparison, "base").firstProblemDate).toBe("None");
    expect(buildBeforeAfterRow(comparison, "scenario").firstProblemDate).toBe("None");
    expect(shouldShowRiskDaysSummary(comparison)).toBe(false);
    expect(shouldShowFirstProblemDaySummary(comparison)).toBe(false);
  });

  it("builds summary card headline and highlights for one-time income", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 3, scenario: 0, delta: "-3" },
        lowest_projected_balance: { base: "-303.40", scenario: "1196.60", delta: "1500" },
        first_risk_date: { base: "2026-05-15", scenario: null, delta: null },
      },
      risk_explanation: {
        is_risky: false,
        base_lowest_balance: "-303.40",
        scenario_lowest_balance: "1196.60",
        first_problem_date: null,
      },
    } as ScenarioComparisonResponse;

    const planItems = [
      {
        id: "ev-1",
        title: "bonus",
        costLabel: "+$1,500 one-time",
        actionLabel: "Added bonus",
        detailLabel: "+$1,500.00 on 05-30-26",
        text: "",
        sortDate: "2026-05-30",
        kind: "event" as const,
        sourceId: 1,
        dateLabel: "05-30-26",
        accountLabel: null,
        changePhrase: "",
        whyBullet: "",
        impactKind: "one_time_income" as const,
        impactAmount: 1500,
      },
    ];

    const decision = deriveScenarioDecision(comparison, planItems);
    expect(decision?.verdict).toBe("better");
    expect(buildPlanSummaryHeadline(decision!, planItems, comparison)).toBe(
      "Adding this bonus improves your financial outlook."
    );

    const highlights = buildPlanSummaryHighlights(comparison, planItems, decision!);
    expect(highlights.some((h) => h.includes("$1,500") && h.includes("05-30-26"))).toBe(true);
    expect(highlights.some((h) => h.includes("lowest balance improves"))).toBe(true);
    expect(highlights.some((h) => h.includes("shortfall"))).toBe(true);

    const summary = buildPlanSummary(comparison, planItems);
    expect(summary?.result).toBe("SAFE");
    expect(summary?.showMetricsFooter).toBe(false);
    expect(summary?.footerLines).toEqual([]);
    expect(summary?.listItems.some((h) => h.includes("shortfall"))).toBe(true);
    expect(summary?.listStyle).toBe("benefits");
    expect(summary?.listItems.some((line) => line.includes("lowest balance improves"))).toBe(true);
    expect(summary?.headline).toContain("bonus");
    expect(shouldShowFirstProblemDaySummary(comparison)).toBe(false);
  });

  it("shows lowest balance change with before and after dates", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 1, scenario: 0, delta: "-1" },
        lowest_projected_balance: { base: "-96.26", scenario: "0.59", delta: "96.85" },
        lowest_projected_balance_date: {
          base: "2026-12-02",
          scenario: "2026-06-04",
          delta: null,
        },
        first_risk_date: { base: "2026-12-02", scenario: null, delta: null },
      },
      risk_explanation: {
        is_risky: false,
        base_lowest_balance: "-96.26",
        base_lowest_balance_date: "2026-12-02",
        scenario_lowest_balance: "0.59",
        scenario_lowest_balance_date: "2026-06-04",
        first_problem_date: null,
      },
    } as ScenarioComparisonResponse;

    const planItems = [
      {
        id: "ev-gift",
        title: "GIFT",
        costLabel: "+$100 one-time",
        actionLabel: "Added GIFT",
        detailLabel: "+$100.00 on 06-17-26",
        text: "",
        sortDate: "2026-06-17",
        kind: "event" as const,
        sourceId: 1,
        dateLabel: "06-17-26",
        accountLabel: "Chase",
        changePhrase: "",
        whyBullet: "GIFT adds $100.",
        impactKind: "one_time_income" as const,
        impactAmount: 100,
      },
    ];

    const decision = deriveScenarioDecision(comparison, planItems)!;
    expect(formatLowestBalanceOutlookChange(comparison, decision.before, decision.after, "improves")).toBe(
      "Your lowest balance improves from -$96.26 on 12-02-26 to $0.59 on 06-04-26"
    );

    const summary = buildPlanSummary(comparison, planItems);
    expect(summary?.listItems.some((line) => line.includes("12-02-26"))).toBe(true);
    expect(summary?.listItems.some((line) => line.includes("06-04-26"))).toBe(true);
    expect(summary?.showMetricsFooter).toBe(false);
  });

  it("uses change-to wording for recurring override headlines", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 0, scenario: 0, delta: "0" },
        lowest_projected_balance: { base: "-303.40", scenario: "1025.56", delta: "1328.96" },
        first_risk_date: { base: null, scenario: null, delta: null },
      },
      risk_explanation: {
        is_risky: false,
        base_lowest_balance: "-303.40",
        scenario_lowest_balance: "1025.56",
        first_problem_date: null,
      },
    } as ScenarioComparisonResponse;

    const planItems = [
      {
        id: "ov-1",
        title: "2930 JOHN GALT S PAYROLL PPD ID: 14409866",
        costLabel: "+$664.48/month",
        actionLabel: "Increased 2930 JOHN GALT S PAYROLL PPD ID: 14409866",
        detailLabel: "$1,835.52 → $2,500.00",
        text: "",
        sortDate: "2026-05-01",
        kind: "override" as const,
        sourceId: 1,
        dateLabel: null,
        accountLabel: null,
        changePhrase: "",
        whyBullet: "",
        impactKind: "recurring" as const,
        impactAmount: 664.48,
      },
    ];

    const headline = buildPlanSummaryHeadline(
      deriveScenarioDecision(comparison, planItems)!,
      planItems,
      comparison
    );
    expect(headline).toBe(
      "This change to 2930 JOHN GALT S PAYROLL PPD ID: 14409866 improves your financial outlook."
    );
  });

  it("builds risky summary with Impact bullets", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 0, scenario: 3, delta: "3" },
        lowest_projected_balance: { base: "0.59", scenario: "-200.15", delta: "-200.74" },
        first_risk_date: { base: null, scenario: "2026-11-06", delta: null },
        last_risk_date: { base: null, scenario: "2027-05-15", delta: null },
      },
      risk_explanation: {
        is_risky: true,
        first_problem_date: "2026-11-06",
        first_problem_account_name: "Main",
        base_lowest_balance: "0.59",
        base_lowest_balance_date: "2026-11-06",
        scenario_lowest_balance: "-200.15",
        scenario_lowest_balance_date: "2026-11-06",
        amount_needed_to_stay_safe: "200.15",
      },
    } as ScenarioComparisonResponse;

    const planItems = [
      {
        id: "ov-1",
        title: "HBO",
        costLabel: "+$75/month",
        actionLabel: "Added HBO subscription",
        detailLabel: "+$75/month",
        text: "",
        sortDate: "2026-05-01",
        kind: "override" as const,
        sourceId: 1,
        dateLabel: null,
        accountLabel: null,
        changePhrase: "",
        whyBullet: "",
        impactKind: "recurring" as const,
        impactAmount: 75,
      },
    ];

    const decision = deriveScenarioDecision(comparison, planItems);
    const summary = buildPlanSummary(comparison, planItems);

    expect(summary?.result).toBe("RISKY");
    expect(summary?.headline).toBe("This change creates a cash problem.");
    expect(summary?.listStyle).toBe("impact");
    expect(summary?.listHeading).toBe("Impact");
    expect(summary?.showMetricsFooter).toBe(false);

    const impact = buildPlanSummaryImpactLines(comparison, planItems, decision!);
    expect(impact[0]).toBe("Adds $75/month expense");
    expect(impact.some((l) => l.includes("Your account will become negative on") && l.includes("11-06-26"))).toBe(true);
    expect(impact.some((l) => l.includes("lowest balance falls") && l.includes("-$200.15"))).toBe(true);
    expect(impact.some((l) => l.includes("3 times from") && l.includes("05-15-27"))).toBe(true);
    expect(impact.some((l) => l.includes("To make this safe") && l.includes("200.15"))).toBe(true);
  });

  it("shows plain-english shortfall footer for risky plans in impact list, not footer", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 2, scenario: 3, delta: "1" },
        lowest_projected_balance: { base: "-10", scenario: "-50", delta: "-40" },
        first_risk_date: { base: "2026-06-12", scenario: "2026-06-12", delta: "0" },
      },
      risk_explanation: {
        is_risky: true,
        first_problem_date: "2026-06-12",
        scenario_first_problem_date: "2026-06-12",
        first_problem_account_name: "Main",
        base_lowest_balance: "-10",
        base_lowest_balance_date: "2026-06-12",
        scenario_lowest_balance: "-50",
        scenario_lowest_balance_date: "2026-06-12",
        amount_needed_to_stay_safe: "50",
      },
    } as ScenarioComparisonResponse;

    const summary = buildPlanSummary(comparison, []);
    expect(summary?.result).toBe("RISKY");
    expect(summary?.showMetricsFooter).toBe(false);
    expect(summary?.footerLines).toEqual([]);
    expect(summary?.listItems.some((l) => l.includes("will become negative"))).toBe(true);
    expect(summary?.listItems.some((l) => l.includes("To make this safe"))).toBe(true);
  });

  it("shows plain-english shortfall footer when forecast already dips below zero", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 1, scenario: 1, delta: "0" },
        lowest_projected_balance: { base: "-96.26", scenario: "-96.26", delta: "0" },
        first_risk_date: { base: "2026-12-02", scenario: "2026-12-02", delta: "0" },
      },
      risk_explanation: {
        is_risky: false,
        scenario_first_problem_date: "2026-12-02",
        base_lowest_balance: "-96.26",
        base_lowest_balance_date: "2026-12-02",
        scenario_lowest_balance: "-96.26",
        scenario_lowest_balance_date: "2026-12-02",
        amount_needed_to_stay_safe: "96.26",
      },
    } as ScenarioComparisonResponse;

    const summary = buildPlanSummary(comparison, []);
    expect(summary?.result).toBe("NO CHANGE");
    expect(summary?.showMetricsFooter).toBe(true);
    expect(summary?.footerLines).toEqual([
      "Your account will become negative on 12-02-26",
      "Your lowest balance reaches -$96.26 on 12-02-26",
      "To avoid this: Add at least $96.26 before 12-02-26",
    ]);
  });

  it("hides summary first problem day when scenario has no problem even if base did", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 2, scenario: 0, delta: "-2" },
        lowest_projected_balance: { base: "-303.40", scenario: "196.60", delta: "500" },
        first_risk_date: { base: "2026-06-12", scenario: null, delta: null },
      },
      risk_explanation: {
        is_risky: false,
        base_lowest_balance: "-303.40",
        scenario_lowest_balance: "196.60",
        first_problem_date: null,
      },
    } as ScenarioComparisonResponse;

    expect(shouldShowFirstProblemDaySummary(comparison)).toBe(false);
    const summary = buildPlanSummary(comparison, [
      {
        id: "ar-1",
        title: "Rental",
        costLabel: "+$500.00/month",
        actionLabel: "Added Rental",
        detailLabel: "+$500.00/month",
        text: "",
        sortDate: "2026-06-01",
        kind: "added_recurring" as const,
        sourceId: 1,
        dateLabel: "06-01-26",
        accountLabel: null,
        changePhrase: "",
        whyBullet: "",
        impactKind: "recurring" as const,
        impactAmount: 500,
        scenarioOnlyAdd: true,
        ruleDirection: "INCOME",
      },
    ]);
    expect(summary?.showMetricsFooter).toBe(false);
    expect(summary?.footerLines).toEqual([]);
    expect(formatDetailedImpactChange("first_risk_date", comparison.metrics.first_risk_date)).toBe(
      DETAILED_IMPACT_NO_CHANGE
    );
  });

  it("formats detailed impact as metric change column", () => {
    const comparison = {
      metrics: {
        lowest_projected_balance: { base: "-303.40", scenario: "1196.60", delta: "1500" },
        ending_cash: { base: "50234.16", scenario: "51734.16", delta: "1500" },
        risk_days: { base: 0, scenario: 0, delta: "0" },
        first_risk_date: { base: null, scenario: null, delta: null },
      },
    } as ScenarioComparisonResponse;

    expect(formatDetailedImpactChange("lowest_projected_balance", comparison.metrics.lowest_projected_balance)).toBe(
      "$1,196.60"
    );
    expect(formatDetailedImpactChange("ending_cash", comparison.metrics.ending_cash)).toBe("$51,734.16");
    expect(formatDetailedImpactChange("risk_days", comparison.metrics.risk_days)).toBe(
      DETAILED_IMPACT_NO_CHANGE
    );
    expect(formatDetailedImpactChange("first_risk_date", comparison.metrics.first_risk_date)).toBe(
      DETAILED_IMPACT_NO_CHANGE
    );
    expect(formatDetailedImpactChange("debt_payoff_date", undefined)).toBe(DETAILED_IMPACT_NO_CHANGE);

    const rows = buildDetailedImpactRows(comparison);
    expect(rows).toHaveLength(5);
    expect(rows[0].label).toBe("Lowest balance");
    expect(rows[0].change).toBe("$1,196.60");
    expect(rows[2].change).toBe(DETAILED_IMPACT_NO_CHANGE);
  });

  it("shows plain scenario values for risky one-time expense", () => {
    const comparison = {
      metrics: {
        lowest_projected_balance: { base: "-303.40", scenario: "-788.40", delta: "-485" },
        ending_cash: { base: "50000", scenario: "49749.16", delta: "-485" },
        risk_days: { base: 0, scenario: 90, delta: "90" },
        first_risk_date: { base: null, scenario: "2026-06-05", delta: null },
        last_risk_date: { base: null, scenario: "2026-11-30", delta: null },
      },
    } as ScenarioComparisonResponse;

    expect(formatDetailedImpactChange("lowest_projected_balance", comparison.metrics.lowest_projected_balance)).toBe(
      "-$788.40"
    );
    expect(formatDetailedImpactChange("ending_cash", comparison.metrics.ending_cash)).toBe("$49,749.16");
    expect(formatDetailedImpactChange("first_risk_date", comparison.metrics.first_risk_date)).toBe("06-05-26");
    expect(formatDetailedImpactChange("risk_days", comparison.metrics.risk_days, comparison)).toContain(
      "90 times from 06-05-26 to 11-30-26"
    );
    expect(formatRiskDaysImpactLine(comparison)).toContain("90 times from 06-05-26 to 11-30-26");
  });

  it("treats expense reduction as safe when lowest balance improves even if still negative", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 90, scenario: 45, delta: "-45" },
        lowest_projected_balance: { base: "-400", scenario: "-350", delta: "50" },
        first_risk_date: { base: "2026-06-01", scenario: "2026-06-01", delta: null },
      },
      risk_explanation: {
        is_risky: true,
        base_lowest_balance: "-400",
        scenario_lowest_balance: "-350",
        first_problem_date: "2026-06-01",
      },
    } as ScenarioComparisonResponse;

    const planItems = [
      {
        id: "ov-1",
        title: "Affirm",
        costLabel: "-$48.17/month",
        actionLabel: "Decreased Affirm",
        detailLabel: "$48.17 → $0.00",
        text: "",
        sortDate: "2026-05-01",
        kind: "override" as const,
        sourceId: 1,
        dateLabel: null,
        accountLabel: null,
        changePhrase: "",
        whyBullet: "",
        impactKind: "recurring" as const,
        impactAmount: -48.17,
      },
    ];

    const decision = deriveScenarioDecision(comparison, planItems);
    expect(decision?.verdict).not.toBe("risky");
    expect(buildPlanSummary(comparison, planItems)?.result).toBe("SAFE");
    expect(buildPlanSummaryHeadline(decision!, planItems, comparison)).toContain("frees up cash");
  });

  it("keeps deprecated deriveScenarioResult working", () => {
    const comparison = {
      metrics: {
        risk_days: { base: 0, scenario: 0, delta: "0" },
        lowest_projected_balance: { base: "500", scenario: "475", delta: "-25" },
        first_risk_date: { base: null, scenario: null, delta: null },
        total_expenses: { base: "1000", scenario: "1025", delta: "25" },
      },
      risk_explanation: {
        is_risky: false,
        base_lowest_balance: "500",
        scenario_lowest_balance: "475",
      },
    } as ScenarioComparisonResponse;
    expect(deriveScenarioResult(comparison, horizonToMonths("12m"))?.headline).toBeTruthy();
  });

  it("includes every plan change in summary highlights, with horizon utilization for debt", () => {
    const comparison = {
      end_date: "2027-05-29",
      metrics: {
        risk_days: { base: 1, scenario: 0, delta: "-1" },
        lowest_projected_balance: { base: "100", scenario: "200.41", delta: "100.41" },
        credit_debt_after_horizon: { base: "2000", scenario: "1500", delta: "-500" },
      },
      risk_explanation: {
        is_risky: false,
        base_lowest_balance: "100",
        scenario_lowest_balance: "200.41",
      },
      credit_utilization_at_horizon: [
        {
          account_id: 2,
          account_name: "Savor",
          base_balance_owed: "637",
          scenario_balance_owed: "0",
          base_utilization_percent: "63.7",
          scenario_utilization_percent: "0",
        },
        {
          account_id: 3,
          account_name: "Amazon",
          base_balance_owed: "500",
          scenario_balance_owed: "250",
          base_utilization_percent: "50",
          scenario_utilization_percent: "25",
        },
      ],
    } as ScenarioComparisonResponse;

    const planItems = [
      {
        id: "ar-1",
        title: "extra",
        costLabel: "$250/mo",
        actionLabel: "extra",
        detailLabel: "$250.00 monthly\nChase → Savor",
        text: "",
        sortDate: "2026-05-01",
        kind: "added_recurring" as const,
        sourceId: 1,
        dateLabel: "05-01-26",
        accountLabel: "Chase → Savor",
        changePhrase: "",
        whyBullet: "",
        impactKind: "debt" as const,
        impactAmount: 250,
      },
      {
        id: "ov-1",
        title: "Payroll",
        costLabel: "",
        actionLabel: "Increased Payroll",
        detailLabel: "$1,835.52 → $2,500.00",
        text: "",
        sortDate: "2026-05-15",
        kind: "override" as const,
        sourceId: 2,
        dateLabel: null,
        accountLabel: "Chase",
        changePhrase: "",
        whyBullet: "",
        impactKind: "recurring" as const,
        impactAmount: 664.48,
      },
      {
        id: "ev-1",
        title: "Transfer",
        costLabel: "",
        actionLabel: "Transfer from Chase Savings to Chase",
        detailLabel: "$500.00 on 05-30-26",
        text: "",
        sortDate: "2026-05-30",
        kind: "event" as const,
        sourceId: 3,
        dateLabel: "05-30-26",
        accountLabel: "Chase Savings → Chase",
        changePhrase: "",
        whyBullet: "",
        impactKind: "transfer" as const,
        impactAmount: 500,
      },
      {
        id: "ev-2",
        title: "Amazon",
        costLabel: "",
        actionLabel: "Pay $249.98 toward Amazon",
        detailLabel: "-$249.98 on 06-19-26",
        text: "",
        sortDate: "2026-06-19",
        kind: "event" as const,
        sourceId: 4,
        dateLabel: "06-19-26",
        accountLabel: "Chase → Amazon",
        changePhrase: "",
        whyBullet: "",
        impactKind: "debt" as const,
        impactAmount: 249.98,
      },
    ];

    const decision = deriveScenarioDecision(comparison, planItems)!;
    const highlights = buildPlanSummaryHighlights(comparison, planItems, decision);

    expect(highlights.some((h) => h.includes("extra") && h.includes("paid off"))).toBe(true);
    expect(highlights.some((h) => h.includes("Payroll") || h.includes("$2,500"))).toBe(true);
    expect(highlights.some((h) => h.includes("Transfer from Chase Savings"))).toBe(true);
    expect(
      highlights.some((h) => h.includes("249.98") && h.includes("Amazon") && h.includes("25%"))
    ).toBe(true);
    expect(highlights.filter((h) => h.includes("utilization falls from")).length).toBe(0);

    expect(planItemChangeImpactLine(planItems[3]!, comparison)).toContain("06-19-26");
    expect(planItemChangeImpactLine(planItems[3]!, comparison)).toContain("Amazon");
  });
});
