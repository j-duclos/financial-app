import type {
  ScenarioComparisonMetric,
  ScenarioComparisonResponse,
  ScenarioForecastChange,
  ScenarioForecastChangeGroup,
  ScenarioRiskExplanation,
  RecurringRuleFrequency,
} from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { formatDateDisplay, formatShortMonthDay } from "./dateDisplay";
import type { PlanIncludeItem } from "./scenarioPlainLanguage";
import { planItemChangeImpactLine, planItemRiskImpactLine } from "./scenarioPlainLanguage";
import { buildDebtImpactHighlights } from "./scenarioDebtPayment";

/** User-facing labels for the developer-only comparison table. */
export const COMPARISON_METRIC_LABELS: Record<string, string> = {
  ending_cash: "Ending cash",
  lowest_projected_balance: "Lowest balance",
  lowest_projected_balance_date: "Lowest balance date",
  safe_to_spend: "Safe to spend",
  total_income: "Total income",
  total_expenses: "Total expenses",
  total_transfers: "Transfers",
  credit_debt_after_horizon: "Credit debt",
  savings_after_horizon: "Savings",
  net_worth_after_horizon: "Net worth",
  risk_days: "Problem days",
  first_risk_date: "First problem date",
};

export const ADVANCED_DETAIL_METRICS = [
  "total_income",
  "total_expenses",
  "ending_cash",
  "savings_after_horizon",
  "credit_debt_after_horizon",
  "total_transfers",
  "net_worth_after_horizon",
] as const;

/** Metrics shown in the optional details collapsible section. */
export const OPTIONAL_DETAIL_METRICS = [
  "lowest_projected_balance",
  "first_risk_date",
  "risk_days",
  "ending_cash",
] as const;

/** Metrics in the simplified Detailed Impact table (metric + change). */
export const DETAILED_IMPACT_METRICS = [
  "lowest_projected_balance",
  "ending_cash",
  "risk_days",
  "first_risk_date",
  "debt_payoff_date",
] as const;

export const DETAILED_IMPACT_NO_CHANGE = "No change";

export interface DetailedImpactRow {
  key: string;
  label: string;
  change: string;
}

export const OPTIONAL_DETAIL_LABELS: Record<string, string> = {
  lowest_projected_balance: "Lowest balance",
  first_risk_date: "Goes negative on",
  risk_days: "Days account goes negative",
  ending_cash: "Ending cash",
  debt_payoff_date: "Debt payoff date",
};

/** Detailed impact shows the scenario plan result, not deltas or before → after. */
const DETAILED_IMPACT_SCENARIO_VALUE_METRICS = new Set([
  "lowest_projected_balance",
  "ending_cash",
]);

export function formatRiskDaysPlainEnglish(dayCount: number): string {
  if (dayCount <= 0) return "None";
  if (dayCount === 1) return "1 day";
  return `${dayCount} days`;
}

/** Impact bullet: when this plan creates repeated cash problems across the forecast window. */
export function formatRiskDaysImpactLine(
  comparison: ScenarioComparisonResponse | undefined
): string | null {
  if (!comparison) return null;
  const count = parseRiskDays(comparison, "scenario");
  if (count <= 0) return null;

  const firstRaw =
    comparison.metrics?.first_risk_date?.scenario ??
    comparison.risk_explanation?.first_problem_date ??
    comparison.risk_explanation?.scenario_first_problem_date;
  const lastRaw = comparison.metrics?.last_risk_date?.scenario;
  const from = firstRaw ? formatDateDisplay(String(firstRaw)) : null;
  const to = lastRaw ? formatDateDisplay(String(lastRaw)) : null;

  if (count === 1 && from) {
    return `Your account will go negative on ${from} if you add this change`;
  }
  if (from && to && from === to) {
    return `Your account will go negative on ${from} if you add this change`;
  }
  if (from && to) {
    return `Your account will go negative ${count} times from ${from} to ${to} if you add this change`;
  }
  if (from) {
    return `Your account will go negative ${count} times starting ${from} if you add this change`;
  }
  return `Your account will go negative ${count} times if you add this change`;
}

export function formatFirstProblemDayPlainEnglish(isoDate: string | null | undefined): string {
  if (isoDate == null || isoDate === "") return "None";
  return formatShortMonthDay(String(isoDate));
}

/** When cash first drops below zero in the plan window. */
export function formatAccountGoesNegativeOn(isoDate: string | null | undefined): string {
  const date = formatScenarioPlanDate(isoDate);
  if (!date) return "None";
  return `Your account will become negative on ${date}`;
}

/** Risky plans: how much extra cash is needed before the first problem date. */
export function formatMakeThisSafeLine(
  comparison: ScenarioComparisonResponse | undefined
): string | null {
  const risk = comparison?.risk_explanation;
  if (!risk?.is_risky) return null;
  return formatAvoidShortfallLine(comparison, "To make this safe");
}

/** Existing forecast shortfall: how low cash goes and what to add before the problem date. */
export function formatAvoidShortfallLine(
  comparison: ScenarioComparisonResponse | undefined,
  prefix = "To avoid this"
): string | null {
  const risk = comparison?.risk_explanation;
  const needed = risk?.amount_needed_to_stay_safe ?? risk?.shortfall_amount;
  if (!needed || parseFloat(String(needed)) <= 0) return null;
  const problemDate =
    risk?.scenario_first_problem_date ??
    risk?.first_problem_date ??
    comparison?.metrics?.first_risk_date?.scenario ??
    risk?.base_first_problem_date;
  const date = formatScenarioPlanDate(problemDate != null ? String(problemDate) : null);
  if (!date) return null;
  return `${prefix}: Add at least ${formatCurrency(needed, "USD")} before ${date}`;
}

export function formatLowestBalanceReachLine(
  comparison: ScenarioComparisonResponse | undefined,
  decision: ScenarioDecision
): string | null {
  const lowest = parseScenarioLowestBalance(comparison);
  if (lowest == null || lowest >= -0.005) return null;
  const date = formatScenarioPlanDate(resolveLowestBalanceDate(comparison, "scenario"));
  const bal = decision.after.lowestBalance;
  if (!date) return `Your lowest balance reaches ${bal}`;
  return `Your lowest balance reaches ${bal} on ${date}`;
}

/** Plain-English footer when the forecast already dips below zero (non-risky plans). */
export function buildPlanSummaryFooterLines(
  comparison: ScenarioComparisonResponse | undefined,
  decision: ScenarioDecision
): string[] {
  const scenarioLowest = parseScenarioLowestBalance(comparison);
  const hasShortfall = scenarioLowest != null && scenarioLowest < -0.005;
  const problemIso = resolveFirstProblemDateRaw(comparison, "scenario");
  if (!hasShortfall && !problemIso) return [];

  const lines: string[] = [];
  const negativeLine = formatAccountGoesNegativeOn(problemIso);
  if (negativeLine !== "None") lines.push(negativeLine);

  const reachLine = formatLowestBalanceReachLine(comparison, decision);
  if (reachLine) lines.push(reachLine);

  const avoidLine = formatAvoidShortfallLine(comparison);
  if (avoidLine) lines.push(avoidLine);

  return [...new Set(lines)];
}

export const FORECAST_PERIOD_OPTIONS: { value: "3m" | "6m" | "12m" | "24m"; label: string }[] = [
  { value: "3m", label: "3 months" },
  { value: "6m", label: "6 months" },
  { value: "12m", label: "12 months" },
  { value: "24m", label: "24 months" },
];

export const EFFECT_KIND_LABELS: Record<string, string> = {
  cash_flow: "Affects cash flow",
  debt: "Affects debt balance",
  savings: "Affects savings balance",
  transfer_only: "Transfer only (net zero across accounts)",
};

export type ScenarioVerdict = "safe" | "tight" | "risky" | "better" | "neutral";

/** User-facing result shown in the plan summary card. */
export type PlanSummaryResult = "SAFE" | "RISKY" | "NO CHANGE";

export type PlanSummaryListStyle = "benefits" | "impact";

export interface PlanSummary {
  result: PlanSummaryResult;
  headline: string;
  listStyle: PlanSummaryListStyle;
  listHeading: string | null;
  listItems: string[];
  showMetricsFooter: boolean;
  footerLines: string[];
  lowestBalance: string;
  recommendation: string;
}

export interface BeforeAfterRow {
  lowestBalance: string;
  firstProblemDate: string;
  problemDays: string;
}

export interface ScenarioDecision {
  verdict: ScenarioVerdict;
  verdictLabel: string;
  headline: string;
  summary: string;
  recommendation: string;
  explanations: string[];
  timingNote: string | null;
  before: BeforeAfterRow;
  after: BeforeAfterRow;
  impactLabel: "Better" | "Worse" | "No meaningful change";
  riskExplanation: ScenarioRiskExplanation | null;
}

export interface CostImpactLine {
  label: string;
  lines: string[];
}

export interface RecurringCostSummary {
  monthly: number;
  annual: number;
  label: string;
}

const CURRENCY_METRICS = new Set([
  "ending_cash",
  "lowest_projected_balance",
  "safe_to_spend",
  "total_income",
  "total_expenses",
  "total_transfers",
  "credit_debt_after_horizon",
  "savings_after_horizon",
  "net_worth_after_horizon",
]);

/** Minimum cushion before we call a plan "tight" instead of fully safe. */
export const CUSHION_THRESHOLD = 100;

export function horizonToMonths(horizon: "3m" | "6m" | "12m" | "24m"): number {
  return { "3m": 3, "6m": 6, "12m": 12, "24m": 24 }[horizon];
}

export function formatComparisonValue(key: string, value: string | number | null): string {
  if (value == null || value === "") {
    return key.endsWith("_date") || key === "first_risk_date" ? "None" : "—";
  }
  if (key.endsWith("_date") || key === "first_risk_date") {
    return formatShortMonthDay(String(value));
  }
  if (key === "risk_days") return String(value);
  if (CURRENCY_METRICS.has(key)) {
    const n = typeof value === "number" ? value : parseFloat(String(value));
    if (Number.isNaN(n)) return String(value);
    return formatCurrency(String(n), "USD");
  }
  return String(value);
}

export function formatComparisonDelta(metric: ScenarioComparisonMetric): string {
  if (metric.delta == null) return "—";
  const n = parseFloat(metric.delta);
  if (Number.isNaN(n)) return String(metric.delta);
  const prefix = n > 0 ? "+" : "";
  return `${prefix}${formatCurrency(String(n), "USD")}`;
}

export function formatSignedCurrency(amount: number): string {
  if (Math.abs(amount) < 0.005) return formatCurrency("0", "USD");
  if (amount > 0) return `+${formatCurrency(String(amount), "USD")}`;
  return `-${formatCurrency(String(Math.abs(amount)), "USD")}`;
}

export function formatSignedDelta(amount: string | number | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (Number.isNaN(n)) return String(amount);
  return formatSignedCurrency(n);
}

export function formatForecastAmount(amount: string | null | undefined): string {
  if (amount == null || amount === "") return "—";
  const n = parseFloat(amount);
  if (Number.isNaN(n)) return amount;
  const prefix = n > 0 ? "+" : n < 0 ? "" : "";
  return `${prefix}${formatCurrency(String(Math.abs(n)), "USD")}`;
}

export function formatFirstProblemDate(value: string | number | null): string {
  if (value == null || value === "") return "None";
  return formatDateDisplay(String(value));
}

/** MM-DD-YY dates on the what-if plan summary card. */
function formatScenarioPlanDate(isoDate: string | null | undefined): string | null {
  if (isoDate == null || isoDate === "") return null;
  const label = formatDateDisplay(String(isoDate));
  return label === "—" ? null : label;
}

function parseMetricNumber(
  comparison: ScenarioComparisonResponse | undefined,
  key: string,
  side: "base" | "scenario"
): number | null {
  const raw = comparison?.metrics?.[key]?.[side];
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isNaN(n) ? null : n;
}

function parseRiskDays(comparison: ScenarioComparisonResponse | undefined, side: "base" | "scenario"): number {
  const raw = comparison?.metrics?.risk_days?.[side];
  if (raw == null || raw === "") return 0;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** First day cash goes negative or a risk day exists — not merely the lowest-balance day. */
function resolveFirstProblemDateRaw(
  comparison: ScenarioComparisonResponse | undefined,
  side: "base" | "scenario"
): string | null {
  if (!comparison) return null;
  const risk = comparison.risk_explanation;
  const m = comparison.metrics;

  if (side === "scenario") {
    if (risk?.first_problem_date) return risk.first_problem_date;
    if (risk?.scenario_first_problem_date) return risk.scenario_first_problem_date;
    if (m?.first_risk_date?.scenario) return String(m.first_risk_date.scenario);
    return null;
  }

  if (risk?.base_first_problem_date) return risk.base_first_problem_date;
  if (m?.first_risk_date?.base) return String(m.first_risk_date.base);
  return null;
}

/** Show risk-day counts only when the what-if plan still has risk days ahead. */
export function shouldShowRiskDaysSummary(
  comparison: ScenarioComparisonResponse | undefined
): boolean {
  return parseRiskDays(comparison, "scenario") > 0;
}

function parseScenarioLowestBalance(
  comparison: ScenarioComparisonResponse | undefined
): number | null {
  const fromMetrics = parseMetricNumber(comparison, "lowest_projected_balance", "scenario");
  if (fromMetrics != null) return fromMetrics;
  const raw = comparison?.risk_explanation?.scenario_lowest_balance;
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw));
  return Number.isNaN(n) ? null : n;
}

/** Summary card: only when this plan still dips below zero ahead. */
export function shouldShowFirstProblemDaySummary(
  comparison: ScenarioComparisonResponse | undefined
): boolean {
  const scenarioLowest = parseScenarioLowestBalance(comparison);
  if (scenarioLowest != null && scenarioLowest >= -0.005) return false;
  return resolveFirstProblemDateRaw(comparison, "scenario") != null;
}

function resolveLowestBalanceDate(
  comparison: ScenarioComparisonResponse | undefined,
  side: "base" | "scenario"
): string | null {
  const risk = comparison?.risk_explanation;
  const metricDate = comparison?.metrics?.lowest_projected_balance_date?.[side];
  const raw =
    side === "base"
      ? risk?.base_lowest_balance_date ?? metricDate
      : risk?.scenario_lowest_balance_date ?? metricDate;
  if (raw == null || raw === "") return null;
  return String(raw);
}

function formatLowestBalanceWithDate(balance: string, isoDate: string | null): string {
  if (!isoDate) return balance;
  return `${balance} on ${formatDateDisplay(isoDate)}`;
}

function formatShortageDate(isoDate: string | null): string | null {
  return formatScenarioPlanDate(isoDate);
}

/** Human-readable lowest-balance outlook with dates so before/after is obvious. */
export function formatLowestBalanceOutlookChange(
  comparison: ScenarioComparisonResponse | undefined,
  before: BeforeAfterRow,
  after: BeforeAfterRow,
  tone: "changed" | "improves" | "changes" = "changed"
): string {
  const beforeBal = before.lowestBalance;
  const afterBal = after.lowestBalance;
  const baseDate = resolveLowestBalanceDate(comparison, "base");
  const scenarioDate = resolveLowestBalanceDate(comparison, "scenario");

  if (beforeBal === afterBal) {
    const date = formatShortageDate(scenarioDate ?? baseDate);
    return date ? `${afterBal} on ${date}` : afterBal;
  }

  const baseDateLabel = formatShortageDate(baseDate);
  const scenarioDateLabel = formatShortageDate(scenarioDate);
  const sameDay =
    baseDate != null && scenarioDate != null && baseDate.slice(0, 10) === scenarioDate.slice(0, 10);
  const baseNum = parseMetricNumber(comparison, "lowest_projected_balance", "base");
  const scenarioNum = parseMetricNumber(comparison, "lowest_projected_balance", "scenario");
  const isImprovement =
    baseNum != null &&
    scenarioNum != null &&
    scenarioNum >= baseNum - 0.005;

  if (tone === "changes" || (tone === "changed" && !isImprovement)) {
    if (sameDay && baseDateLabel) {
      return `Your lowest balance falls from ${beforeBal} to ${afterBal} on ${baseDateLabel}`;
    }
    if (baseDateLabel && scenarioDateLabel) {
      return `Your lowest balance falls from ${beforeBal} on ${baseDateLabel} to ${afterBal} on ${scenarioDateLabel}`;
    }
    return `Your lowest balance falls from ${beforeBal} to ${afterBal}`;
  }

  if (sameDay && baseDateLabel) {
    return `Your lowest balance improves from ${beforeBal} to ${afterBal} on ${baseDateLabel}`;
  }
  if (baseDateLabel && scenarioDateLabel) {
    return `Your lowest balance improves from ${beforeBal} on ${baseDateLabel} to ${afterBal} on ${scenarioDateLabel}`;
  }
  return `Your lowest balance improves from ${beforeBal} to ${afterBal}`;
}

/** Footer lowest balance — scenario value with date/account when unchanged vs baseline. */
export function formatPlanSummaryLowestBalance(
  comparison: ScenarioComparisonResponse | undefined,
  decision: ScenarioDecision
): string {
  const after = decision.after.lowestBalance;
  const before = decision.before.lowestBalance;
  const risk = comparison?.risk_explanation;
  const scenarioDate = resolveLowestBalanceDate(comparison, "scenario");
  const acct = risk?.first_problem_account_name;

  if (before === after) {
    const suffix =
      scenarioDate && acct
        ? ` on ${formatDateDisplay(scenarioDate)} (${acct})`
        : scenarioDate
          ? ` on ${formatDateDisplay(scenarioDate)}`
          : acct
            ? ` (${acct})`
            : "";
    return `${after}${suffix}`;
  }
  return formatLowestBalanceOutlookChange(comparison, decision.before, decision.after, "changed");
}

export function formatPlanSummaryFirstProblemDay(
  comparison: ScenarioComparisonResponse | undefined,
  decision: ScenarioDecision
): string {
  const scenarioIso = resolveFirstProblemDateRaw(comparison, "scenario");
  const baseIso = resolveFirstProblemDateRaw(comparison, "base");
  if (scenarioIso && (!baseIso || baseIso === scenarioIso)) {
    return formatAccountGoesNegativeOn(scenarioIso);
  }
  if (baseIso && scenarioIso) {
    const afterDate = formatScenarioPlanDate(scenarioIso);
    return afterDate
      ? `${formatAccountGoesNegativeOn(baseIso)} → ${afterDate}`
      : formatAccountGoesNegativeOn(baseIso);
  }
  const after = decision.after.firstProblemDate;
  if (after === "None") return after;
  return formatAccountGoesNegativeOn(scenarioIso);
}

export function shouldShowOptionalDetailMetric(
  comparison: ScenarioComparisonResponse | undefined,
  key: string
): boolean {
  if (key === "risk_days") return shouldShowRiskDaysSummary(comparison);
  if (key === "first_risk_date") {
    const metric = comparison?.metrics?.first_risk_date;
    if (!metric) return false;
    return formatDetailedImpactChange("first_risk_date", metric) !== DETAILED_IMPACT_NO_CHANGE;
  }
  return true;
}

export function formatDetailedImpactChange(
  key: string,
  metric: ScenarioComparisonMetric | undefined,
  comparison?: ScenarioComparisonResponse
): string {
  if (key === "debt_payoff_date") {
    return DETAILED_IMPACT_NO_CHANGE;
  }

  if (!metric) return "—";

  if (DETAILED_IMPACT_SCENARIO_VALUE_METRICS.has(key)) {
    return formatComparisonValue(key, metric.scenario);
  }

  if (key === "risk_days") {
    const base = parseInt(String(metric.base ?? "0"), 10) || 0;
    const scenario = parseInt(String(metric.scenario ?? "0"), 10) || 0;
    if (scenario === 0 && base === 0) return DETAILED_IMPACT_NO_CHANGE;
    const line = formatRiskDaysImpactLine(comparison);
    if (line) return line;
    if (scenario === base) return formatRiskDaysPlainEnglish(scenario);
    return formatRiskDaysPlainEnglish(scenario);
  }

  if (key === "first_risk_date") {
    const scenario = metric.scenario;
    if (scenario == null || scenario === "") return DETAILED_IMPACT_NO_CHANGE;
    return formatDateDisplay(String(scenario));
  }

  return DETAILED_IMPACT_NO_CHANGE;
}

export function buildDetailedImpactRows(
  comparison: ScenarioComparisonResponse | undefined
): DetailedImpactRow[] {
  if (!comparison?.metrics) return [];

  return DETAILED_IMPACT_METRICS.map((key) => ({
    key,
    label: OPTIONAL_DETAIL_LABELS[key] ?? key,
    change:
      key === "debt_payoff_date"
        ? DETAILED_IMPACT_NO_CHANGE
        : formatDetailedImpactChange(key, comparison.metrics[key], comparison),
  }));
}

export function buildBeforeAfterRow(
  comparison: ScenarioComparisonResponse | undefined,
  side: "base" | "scenario"
): BeforeAfterRow {
  const risk = comparison?.risk_explanation;
  const m = comparison?.metrics;
  const lowest =
    side === "base"
      ? risk?.base_lowest_balance ?? m?.lowest_projected_balance?.base
      : risk?.scenario_lowest_balance ?? m?.lowest_projected_balance?.scenario;

  return {
    lowestBalance: formatComparisonValue("lowest_projected_balance", lowest ?? null),
    firstProblemDate: formatFirstProblemDate(resolveFirstProblemDateRaw(comparison, side)),
    problemDays: String(parseRiskDays(comparison, side)),
  };
}

export function deriveImpactLabel(
  comparison: ScenarioComparisonResponse | undefined
): "Better" | "Worse" | "No meaningful change" {
  if (!comparison?.metrics) return "No meaningful change";

  const riskDelta = parseInt(comparison.metrics.risk_days?.delta ?? "0", 10) || 0;
  const baseLowest =
    parseMetricNumber(comparison, "lowest_projected_balance", "base") ??
    parseFloat(comparison.risk_explanation?.base_lowest_balance ?? "0");
  const scenarioLowest =
    parseMetricNumber(comparison, "lowest_projected_balance", "scenario") ??
    parseFloat(comparison.risk_explanation?.scenario_lowest_balance ?? "0");

  if (riskDelta > 0 || (scenarioLowest < 0 && baseLowest >= 0) || scenarioLowest < baseLowest - 0.005) {
    return "Worse";
  }
  if (riskDelta < 0 || scenarioLowest > baseLowest + 0.005) {
    return "Better";
  }
  return "No meaningful change";
}

function annualMultiplierForFrequency(frequency: string): number {
  switch (frequency) {
    case "weekly":
      return 52;
    case "biweekly":
      return 26;
    case "yearly":
      return 1;
    default:
      return 12;
  }
}

/** Recurring cost from a traceable per-occurrence delta — not from aggregate expense totals. */
export function recurringCostFromGroup(group: ScenarioForecastChangeGroup): RecurringCostSummary | null {
  const perOcc = parseFloat(group.delta_per_occurrence);
  if (Number.isNaN(perOcc) || Math.abs(perOcc) < 0.005) return null;

  const absPerOcc = Math.abs(perOcc);
  let monthly = absPerOcc;
  if (group.frequency === "weekly") monthly = (absPerOcc * 52) / 12;
  else if (group.frequency === "biweekly") monthly = (absPerOcc * 26) / 12;
  else if (group.frequency === "yearly") monthly = absPerOcc / 12;

  const annual = absPerOcc * annualMultiplierForFrequency(group.frequency);
  const direction = perOcc < 0 ? "increase" : perOcc > 0 ? "decrease" : "change";

  return {
    monthly: perOcc < 0 ? monthly : -monthly,
    annual: perOcc < 0 ? annual : -annual,
    label: direction,
  };
}

export function recurringCostFromPlanItem(
  item: PlanIncludeItem,
  frequency: RecurringRuleFrequency = "MONTHLY_DAY"
): RecurringCostSummary | null {
  if (item.impactKind !== "recurring" || item.impactAmount == null) return null;
  const amt = item.impactAmount;
  if (Math.abs(amt) < 0.005) return null;

  let monthly = Math.abs(amt);
  if (frequency === "WEEKLY") monthly = (Math.abs(amt) * 52) / 12;
  else if (frequency === "BIWEEKLY") monthly = (Math.abs(amt) * 26) / 12;
  else if (frequency === "YEARLY") monthly = Math.abs(amt) / 12;

  let annualMult = 12;
  if (frequency === "WEEKLY") annualMult = 52;
  else if (frequency === "BIWEEKLY") annualMult = 26;
  else if (frequency === "YEARLY") annualMult = 1;

  return {
    monthly: amt < 0 ? monthly : -monthly,
    annual: amt < 0 ? Math.abs(amt) * annualMult : -Math.abs(amt) * annualMult,
    label: amt < 0 ? "increase" : "decrease",
  };
}

function buildTimingNote(
  group: ScenarioForecastChangeGroup | undefined,
  risk: ScenarioRiskExplanation | null | undefined
): string | null {
  if (!group || group.frequency === "one_time") return null;
  const cost = recurringCostFromGroup(group);
  if (!cost || Math.abs(cost.monthly) < 0.005) return null;

  const monthlyLabel = formatSignedCurrency(cost.monthly);
  const account = risk?.first_problem_account_name ?? group.account_name;
  const problemDate = formatFirstProblemDate(risk?.first_problem_date ?? null);

  if (problemDate !== "None" && account) {
    return `This is a recurring ${cost.label} of ${monthlyLabel.replace("+", "")}/month. Because it repeats before future income deposits, it eventually causes ${account} to fall below $0 on ${problemDate}.`;
  }
  return `This is a recurring ${cost.label} of ${monthlyLabel.replace("+", "")}/month across the forecast period. Lowest balance changes come from timing and cumulative impact, not from the annual total alone.`;
}

function buildExplanations(
  comparison: ScenarioComparisonResponse | undefined,
  planItems: PlanIncludeItem[],
  before: BeforeAfterRow,
  after: BeforeAfterRow,
  risk: ScenarioRiskExplanation | null | undefined
): string[] {
  const lines: string[] = [];

  for (const item of planItems.slice(0, 3)) {
    lines.push(item.whyBullet);
  }

  if (risk?.first_problem_date && risk.first_problem_account_name) {
    const trigger = risk.triggering_event ? ` after ${risk.triggering_event}` : "";
    lines.push(
      `${risk.first_problem_account_name} drops below $0 on ${formatFirstProblemDate(risk.first_problem_date)}${trigger}.`
    );
  } else {
    const riskDelta =
      parseRiskDays(comparison, "scenario") - parseRiskDays(comparison, "base");
    if (riskDelta > 0) {
      lines.push(
        `This creates ${riskDelta} new problem day${riskDelta !== 1 ? "s" : ""} in your forecast period.`
      );
    } else if (before.lowestBalance !== after.lowestBalance) {
      lines.push(formatLowestBalanceOutlookChange(comparison, before, after, "changes"));
    }
  }

  return lines.slice(0, 4);
}

export function derivePlanSummaryResult(verdict: ScenarioVerdict): PlanSummaryResult {
  if (verdict === "risky") return "RISKY";
  if (verdict === "neutral") return "NO CHANGE";
  if (verdict === "better" || verdict === "safe" || verdict === "tight") return "SAFE";
  return "SAFE";
}

function planItemHeadlineLabel(item: PlanIncludeItem): string {
  const title = item.title.trim();
  if (title && title.toLowerCase() !== "one-time change") return title;
  if (item.impactKind === "one_time_income") return "income";
  if (item.impactKind === "one_time_expense") return "expense";
  return "change";
}

export function buildPlanSummaryHeadline(
  decision: ScenarioDecision,
  planItems: PlanIncludeItem[],
  comparison: ScenarioComparisonResponse | undefined
): string {
  const single = planItems.length === 1 ? planItems[0] : null;
  const risk = comparison?.risk_explanation;
  const creditOnly = risk?.impact_scope === "credit_only" && risk?.cash_lowest_unchanged;

  if (creditOnly && single && decision.verdict !== "risky") {
    return `Changing ${planItemHeadlineLabel(single)} updates your credit card balance.`;
  }

  if (decision.verdict === "risky") {
    return "This change creates a cash problem.";
  }

  if (decision.verdict === "neutral") {
    if (planItems.length === 0) {
      return "Add a change to see how it affects your cash flow.";
    }
    return "This plan makes little difference in this period.";
  }

  if (single) {
    const label = planItemHeadlineLabel(single);
    const isRecurringChange = single.impactKind === "recurring";
    const isScenarioOnlyAdd = single.scenarioOnlyAdd === true;
    const isExpenseReduction =
      single.actionLabel.startsWith("Removed") ||
      (isRecurringChange &&
        single.impactAmount != null &&
        single.impactAmount < -0.005);
    const isDebtPayment = single.impactKind === "debt";
    const isExpenseIncrease =
      single.impactKind === "one_time_expense" ||
      (isRecurringChange &&
        single.impactAmount != null &&
        single.impactAmount > 0.005);

    if (decision.verdict === "tight") {
      return isExpenseReduction
        ? `Cutting ${label} helps, but cash is still very tight.`
        : isRecurringChange && !isScenarioOnlyAdd
          ? `You can afford this change to ${label}, but it leaves very little cushion.`
          : `You can afford this ${label}, but it leaves very little cushion.`;
    }
    if (isExpenseReduction && (decision.verdict === "better" || decision.verdict === "safe")) {
      return `Lowering or stopping ${label} frees up cash in this plan.`;
    }
    if (isDebtPayment && (decision.verdict === "better" || decision.verdict === "safe")) {
      return `Paying down ${label} improves your debt outlook without adding spending.`;
    }
    if (isExpenseIncrease && decision.verdict === "safe") {
      return isRecurringChange && !isScenarioOnlyAdd
        ? `This change to ${label} fits within your cash flow.`
        : `Adding this ${label} fits within your cash flow.`;
    }
    if (decision.verdict === "better" || decision.verdict === "safe") {
      return isRecurringChange && !isScenarioOnlyAdd
        ? `This change to ${label} improves your financial outlook.`
        : `Adding this ${label} improves your financial outlook.`;
    }
  }

  if (planItems.length > 1) {
    if (decision.verdict === "better" || decision.verdict === "safe") {
      return "These changes improve your financial outlook.";
    }
    if (decision.verdict === "tight") {
      return "You can afford these changes, but they leave very little cushion.";
    }
  }

  return decision.recommendation;
}

export function buildPlanSummaryImpactLines(
  comparison: ScenarioComparisonResponse | undefined,
  planItems: PlanIncludeItem[],
  decision: ScenarioDecision
): string[] {
  const lines: string[] = [];
  const risk = comparison?.risk_explanation;

  for (const item of planItems) {
    const line = planItemRiskImpactLine(item);
    if (line) lines.push(line);
  }

  const problemDate = risk?.first_problem_date ?? null;
  if (problemDate) {
    lines.push(formatAccountGoesNegativeOn(problemDate));
  }

  if (decision.before.lowestBalance !== decision.after.lowestBalance) {
    lines.push(
      formatLowestBalanceOutlookChange(
        comparison,
        decision.before,
        decision.after,
        "changes"
      )
    );
  }

  const scenarioRisk = parseRiskDays(comparison, "scenario");
  const baseRisk = parseRiskDays(comparison, "base");
  const riskLine = formatRiskDaysImpactLine(comparison);
  if (riskLine && scenarioRisk > 0 && scenarioRisk > baseRisk) {
    lines.push(riskLine);
  }

  const safeLine = formatMakeThisSafeLine(comparison);
  if (safeLine && decision.verdict === "risky") {
    lines.push(safeLine);
  }

  return [...new Set(lines)];
}

export function buildPlanSummaryHighlights(
  comparison: ScenarioComparisonResponse | undefined,
  planItems: PlanIncludeItem[],
  decision: ScenarioDecision,
  _accounts: import("@budget-app/shared").Account[] = []
): string[] {
  const lines: string[] = [];
  const risk = comparison?.risk_explanation;
  const creditOnly = risk?.impact_scope === "credit_only" && risk?.cash_lowest_unchanged;

  const debtHighlights = buildDebtImpactHighlights(comparison, planItems);
  if (debtHighlights.length > 0) {
    lines.push(...debtHighlights);
  }

  if (creditOnly && decision.verdict !== "risky") {
    const traceable = risk?.traceable_credit_charge_delta;
    const perOcc = risk?.traceable_per_occurrence;
    const count = risk?.traceable_occurrence_count;
    if (traceable && parseFloat(traceable) > 0.005) {
      if (perOcc && count && count > 0) {
        lines.push(
          `Adds ${formatCurrency(perOcc, "USD")}/month × ${count} charges (${formatCurrency(traceable, "USD")})`
        );
      } else {
        lines.push(`Adds ${formatCurrency(traceable, "USD")} in card charges`);
      }
    }
    lines.push("Checking and savings low points stay the same");
  } else {
    const beforeBal = decision.before.lowestBalance;
    const afterBal = decision.after.lowestBalance;
    const baseLowest =
      parseMetricNumber(comparison, "lowest_projected_balance", "base") ??
      parseFloat(risk?.base_lowest_balance ?? "NaN");
    const scenarioLowest =
      parseMetricNumber(comparison, "lowest_projected_balance", "scenario") ??
      parseFloat(risk?.scenario_lowest_balance ?? "NaN");

    if (
      beforeBal !== afterBal &&
      !Number.isNaN(baseLowest) &&
      !Number.isNaN(scenarioLowest)
    ) {
      if (scenarioLowest > baseLowest + 0.005) {
        lines.push(
          formatLowestBalanceOutlookChange(
            comparison,
            decision.before,
            decision.after,
            "improves"
          )
        );
      } else if (scenarioLowest < baseLowest - 0.005) {
        lines.push(
          formatLowestBalanceOutlookChange(
            comparison,
            decision.before,
            decision.after,
            "changes"
          )
        );
      }
    }

    const baseRisk = parseRiskDays(comparison, "base");
    const scenarioRisk = parseRiskDays(comparison, "scenario");
    if (baseRisk > 0 && scenarioRisk === 0) {
      lines.push("Removes future cash shortfalls");
    }
    if (
      !Number.isNaN(baseLowest) &&
      !Number.isNaN(scenarioLowest) &&
      baseLowest < 0 &&
      scenarioLowest >= 0 &&
      !lines.some((l) => l.includes("shortfall"))
    ) {
      lines.push("Removes future cash shortfalls");
    }
  }

  for (const item of planItems) {
    const line = planItemChangeImpactLine(item, comparison);
    if (line && !lines.includes(line)) lines.push(line);
  }

  return [...new Set(lines)];
}

export function buildPlanSummary(
  comparison: ScenarioComparisonResponse | undefined,
  planItems: PlanIncludeItem[] = [],
  accounts: import("@budget-app/shared").Account[] = []
): PlanSummary | null {
  const decision = deriveScenarioDecision(comparison, planItems);
  if (!decision) return null;

  const isRisky = decision.verdict === "risky";
  const footerLines = isRisky ? [] : buildPlanSummaryFooterLines(comparison, decision);

  return {
    result: derivePlanSummaryResult(decision.verdict),
    headline: buildPlanSummaryHeadline(decision, planItems, comparison),
    listStyle: isRisky ? "impact" : "benefits",
    listHeading: isRisky ? "Impact" : null,
    listItems: isRisky
      ? buildPlanSummaryImpactLines(comparison, planItems, decision)
      : buildPlanSummaryHighlights(comparison, planItems, decision, accounts),
    showMetricsFooter: footerLines.length > 0,
    footerLines,
    lowestBalance: formatPlanSummaryLowestBalance(comparison, decision),
    recommendation: decision.recommendation,
  };
}

export interface WhyExplanation {
  heading: string;
  bullets: string[];
}

export function deriveWhyExplanation(
  comparison: ScenarioComparisonResponse | undefined,
  planItems: PlanIncludeItem[] = []
): WhyExplanation | null {
  if (!comparison?.metrics) return null;

  const decision = deriveScenarioDecision(comparison, planItems);
  if (!decision) return null;

  const risk = comparison.risk_explanation;
  const isRisky = decision.verdict === "risky";
  const creditOnly = risk?.impact_scope === "credit_only";
  const cashUnchanged = risk?.cash_lowest_unchanged === true;

  const heading = isRisky
    ? "Why does this create a problem?"
    : creditOnly && planItems.length > 0
      ? "What this changes"
      : decision.verdict === "better"
        ? "Why does this help?"
        : planItems.length === 0
          ? "What to expect"
          : "Why the result changed";

  const bullets: string[] = [];

  for (const item of planItems.slice(0, 3)) {
    bullets.push(item.whyBullet);
  }

  if (creditOnly && cashUnchanged && !isRisky) {
    const traceable = risk?.traceable_credit_charge_delta;
    const perOcc = risk?.traceable_per_occurrence;
    const count = risk?.traceable_occurrence_count;
    if (traceable && parseFloat(traceable) > 0.005) {
      if (perOcc && count && count > 0) {
        bullets.push(
          `Extra card charges: ${formatCurrency(perOcc, "USD")}/month × ${count} charges = ${formatCurrency(traceable, "USD")} in this period.`
        );
      } else {
        bullets.push(
          `Extra card charges total ${formatCurrency(traceable, "USD")} in this period.`
        );
      }
    }
    bullets.push("Your checking and savings low points stay the same.");
  } else {
    const account = risk?.first_problem_account_name;
    if (isRisky && account) {
      bullets.push(`This reduces ${account} account balances over time.`);
    }

    if (isRisky && risk?.first_problem_date) {
      bullets.push(formatAccountGoesNegativeOn(risk.first_problem_date));
    }

    if (decision.before.lowestBalance !== decision.after.lowestBalance) {
      bullets.push(
        formatLowestBalanceOutlookChange(
          comparison,
          decision.before,
          decision.after,
          "changes"
        )
      );
    } else if (!isRisky && decision.verdict === "better") {
      bullets.push("Your cash cushion improves without creating new overdrafts.");
    } else if (!isRisky && decision.verdict === "safe") {
      bullets.push("This change fits within your current cash flow.");
    }
  }

  if (bullets.length === 0) {
    bullets.push("Add a change to this plan to see how it affects your future cash flow.");
  }

  return { heading, bullets: bullets.slice(0, 5) };
}

function buildRecommendation(
  verdict: ScenarioVerdict,
  risk: ScenarioRiskExplanation | null | undefined,
  scenarioLowest: number
): string {
  const creditOnly = risk?.impact_scope === "credit_only";
  const cashUnchanged = risk?.cash_lowest_unchanged === true;

  if (creditOnly && cashUnchanged && verdict !== "risky") {
    return "This increases credit card debt but does not affect your checking balance.";
  }

  switch (verdict) {
    case "safe":
      return "This change is safe.";
    case "tight":
      return "You can make this change, but keep an eye on upcoming bills.";
    case "risky": {
      const needed = risk?.amount_needed_to_stay_safe ?? risk?.shortfall_amount;
      const problemDate = formatScenarioPlanDate(risk?.first_problem_date ?? null);
      if (needed && parseFloat(needed) > 0) {
        const amt = formatCurrency(needed, "USD");
        if (problemDate) {
          return `To make this safe: Add at least ${amt} before ${problemDate}.`;
        }
        return `To make this safe: Add at least ${amt} to cover the shortfall.`;
      }
      if (scenarioLowest < 0) {
        return `Do not make this change unless you add at least ${formatCurrency(String(Math.abs(scenarioLowest)), "USD")} to cover the shortfall first.`;
      }
      return "Do not make this change without adjusting your cash first.";
    }
    case "better":
      return "This improves your financial outlook.";
    default:
      return "Add a change to this plan to see what happens.";
  }
}

export function deriveScenarioDecision(
  comparison: ScenarioComparisonResponse | undefined,
  planItems: PlanIncludeItem[] = []
): ScenarioDecision | null {
  if (!comparison?.metrics) return null;

  const risk = comparison.risk_explanation ?? null;

  const baseLowest =
    parseMetricNumber(comparison, "lowest_projected_balance", "base") ??
    parseFloat(risk?.base_lowest_balance ?? "0");
  const scenarioLowest =
    parseMetricNumber(comparison, "lowest_projected_balance", "scenario") ??
    parseFloat(risk?.scenario_lowest_balance ?? "0");
  const baseRisk = parseRiskDays(comparison, "base");
  const scenarioRisk = parseRiskDays(comparison, "scenario");
  const riskDelta = scenarioRisk - baseRisk;
  const newOverdraft = scenarioLowest < 0 && baseLowest >= 0;

  const before = buildBeforeAfterRow(comparison, "base");
  const after = buildBeforeAfterRow(comparison, "scenario");
  const impactLabel = deriveImpactLabel(comparison);
  const explanations = buildExplanations(comparison, planItems, before, after, risk);
  const timingNote = buildTimingNote(undefined, risk);

  let verdict: ScenarioVerdict = "neutral";
  let verdictLabel = "NO CHANGE";
  let headline = "This plan makes little difference in this period.";
  let summary = "Add income, expenses, or bill changes to test a decision.";

  const cashImproves = scenarioLowest >= baseLowest - 0.005;
  const isRisky = Boolean(risk?.is_risky) && !cashImproves;
  const isBetter =
    !isRisky &&
    (riskDelta < 0 || cashImproves || (scenarioLowest >= 0 && scenarioLowest > baseLowest));
  const isTight =
    !isRisky && !isBetter && scenarioLowest >= 0 && scenarioLowest < CUSHION_THRESHOLD;

  if (
    planItems.length === 0 &&
    Math.abs(riskDelta) === 0 &&
    Math.abs(scenarioLowest - baseLowest) < 0.01
  ) {
    verdict = "neutral";
  } else if (isRisky) {
    verdict = "risky";
    verdictLabel = "RISKY";
    headline = "This change creates a cash problem.";
    const problemDate = formatFirstProblemDate(risk?.first_problem_date ?? null);
    const account = risk?.first_problem_account_name;
    if (problemDate !== "None" && account) {
      summary = `${account} goes negative on ${problemDate}.`;
    } else if (scenarioLowest < 0 && problemDate !== "None") {
      summary = `This plan causes an account to go negative on ${problemDate}.`;
    } else if (riskDelta > 0) {
      summary = `This plan adds ${riskDelta} problem day${riskDelta !== 1 ? "s" : ""} to your forecast.`;
    } else {
      summary = "This plan increases your cash risk.";
    }
  } else if (isBetter) {
    verdict = "better";
    verdictLabel = "BETTER";
    headline = "This improves your plan.";
    if (riskDelta < 0) {
      summary = `This removes ${Math.abs(riskDelta)} problem day${Math.abs(riskDelta) !== 1 ? "s" : ""} and strengthens your cushion.`;
    } else {
      summary = "Your lowest future balance improves without creating new problems.";
    }
  } else if (isTight) {
    verdict = "tight";
    verdictLabel = "TIGHT";
    headline = "You can afford this, but it leaves very little cushion.";
    summary = `Your lowest balance would be ${after.lowestBalance} — close to zero.`;
  } else {
    verdict = "safe";
    verdictLabel = "GOOD IDEA";
    headline = "You can afford this change.";
    summary =
      after.problemDays === "0"
        ? "This does not create any overdrafts or credit-limit problems."
        : "This does not create any new overdrafts or credit-limit problems.";
  }

  return {
    verdict,
    verdictLabel,
    headline,
    summary,
    recommendation: buildRecommendation(verdict, risk, scenarioLowest),
    explanations,
    timingNote,
    before,
    after,
    impactLabel,
    riskExplanation: risk,
  };
}

export function deriveCostImpactLines(
  planItems: PlanIncludeItem[],
  comparison: ScenarioComparisonResponse | undefined,
  _horizonMonths: number
): CostImpactLine[] {
  const sections: CostImpactLine[] = [];
  const groups = comparison?.forecast_change_groups ?? [];

  for (const group of groups) {
    if (group.frequency === "one_time") {
      sections.push({
        label: "One-time change",
        lines: [`${group.event}: ${formatForecastAmount(group.total_delta)}`],
      });
      continue;
    }

    const cost = recurringCostFromGroup(group);
    if (!cost) continue;

    const monthlyAbs = formatCurrency(String(Math.abs(cost.monthly)), "USD");
    const annualAbs = formatCurrency(String(Math.abs(cost.annual)), "USD");
    const changeWord = cost.label === "increase" ? "Expense change" : "Expense change";
    sections.push({
      label: changeWord,
      lines: [
        `${changeWord}: ${formatSignedCurrency(cost.monthly)}/month`,
        `Annual impact: ${formatSignedCurrency(cost.annual)}/year (${group.occurrence_count} occurrence${group.occurrence_count !== 1 ? "s" : ""} in forecast)`,
      ],
    });

    if (group.occurrence_count > 1) {
      sections[sections.length - 1].lines.push(
        `Per occurrence: ${formatForecastAmount(group.delta_per_occurrence)} (${monthlyAbs}/month equivalent)`
      );
    }
  }

  if (sections.length === 0) {
    const oneTimeExpenses = planItems.filter((i) => i.impactKind === "one_time_expense");
    const oneTimeIncome = planItems.filter((i) => i.impactKind === "one_time_income");
    const recurring = planItems.filter((i) => i.impactKind === "recurring");

    if (oneTimeExpenses.length > 0) {
      const total = oneTimeExpenses.reduce((s, i) => s + (i.impactAmount ?? 0), 0);
      sections.push({
        label: "Expense change",
        lines: [
          oneTimeExpenses.length === 1 && oneTimeExpenses[0].impactAmount != null
            ? formatSignedCurrency(-Math.abs(oneTimeExpenses[0].impactAmount)) + " one-time"
            : `${formatSignedCurrency(-Math.abs(total))} total one-time`,
        ],
      });
    }

    for (const item of recurring) {
      const cost = recurringCostFromPlanItem(item);
      if (!cost) continue;
      sections.push({
        label: "Expense change",
        lines: [
          `Expense change: ${formatSignedCurrency(cost.monthly)}/month`,
          `Annual impact: ${formatSignedCurrency(cost.annual)}/year`,
        ],
      });
    }

    if (oneTimeIncome.length > 0) {
      sections.push({
        label: "Income change",
        lines: oneTimeIncome.map((i) =>
          i.impactAmount != null
            ? `Income change: ${formatSignedCurrency(Math.abs(i.impactAmount))} one-time`
            : i.costLabel
        ),
      });
    }
  }

  return sections;
}

export function formatChangeGroupCard(group: ScenarioForecastChangeGroup): {
  title: string;
  dateLabel: string;
  accountLabel: string;
  before: string;
  after: string;
  difference: string;
  effectLabel: string;
  recurringNote: string | null;
} {
  const dateLabel = group.first_date ? formatShortMonthDay(group.first_date) : "—";
  const effectLabel = EFFECT_KIND_LABELS[group.effect_kind] ?? group.effect_kind;

  let recurringNote: string | null = null;
  if (group.frequency !== "one_time" && group.occurrence_count > 1) {
    recurringNote = `Repeats ${group.frequency} — ${group.occurrence_count} occurrences — total impact ${formatForecastAmount(group.total_delta)}`;
  }

  return {
    title: group.event,
    dateLabel,
    accountLabel: group.account_name || "—",
    before: formatForecastAmount(group.base_amount),
    after: formatForecastAmount(group.scenario_amount),
    difference: formatSignedDelta(group.delta_per_occurrence),
    effectLabel,
    recurringNote,
  };
}

export function formatForecastChangeRow(change: ScenarioForecastChange): {
  date: string;
  account: string;
  event: string;
  currentPlan: string;
  withPlan: string;
  difference: string;
} {
  return {
    date: change.date ? formatShortMonthDay(change.date) : "—",
    account: change.account_name || "—",
    event: change.event,
    currentPlan: formatForecastAmount(change.base_amount),
    withPlan: formatForecastAmount(change.scenario_amount),
    difference: formatSignedDelta(change.delta),
  };
}

export function timelineUrlWithScenario(scenarioId: number, horizon?: string): string {
  const params = new URLSearchParams({ scenario_id: String(scenarioId) });
  if (horizon) params.set("horizon", horizon);
  return `/timeline?${params.toString()}`;
}

export const PLAN_SUMMARY_RESULT_STYLES: Record<PlanSummaryResult, string> = {
  SAFE: "border-green-300 bg-green-50 text-green-950",
  RISKY: "border-red-300 bg-red-50 text-red-950",
  "NO CHANGE": "border-gray-200 bg-gray-50 text-gray-900",
};

/** @deprecated use deriveScenarioDecision */
export function deriveScenarioResult(
  comparison: ScenarioComparisonResponse | undefined,
  horizonMonths: number
) {
  const decision = deriveScenarioDecision(comparison, []);
  if (!decision) return null;
  const group = comparison?.forecast_change_groups?.[0];
  const cost = group ? recurringCostFromGroup(group) : null;
  return {
    verdict: decision.verdict === "better" || decision.verdict === "tight" ? "safe" : decision.verdict,
    headline: decision.headline,
    footnote: decision.summary,
    lowestBalanceLine: formatLowestBalanceOutlookChange(
      comparison,
      decision.before,
      decision.after,
      "changed"
    ),
    monthlyCostLine:
      !cost || Math.abs(cost.monthly) < 0.005
        ? "No change"
        : `${formatSignedCurrency(cost.monthly)}/month`,
    firstRiskDayLine: `${decision.before.firstProblemDate} → ${decision.after.firstProblemDate}`,
  };
}

/** @deprecated — do not use aggregate expense totals for recurring cost */
export function computeCostImpact(
  _comparison: ScenarioComparisonResponse | undefined,
  _horizonMonths: number
): { monthly: number; annual: number } {
  return { monthly: 0, annual: 0 };
}

/** @deprecated */
export function computeIncomeImpact(
  _comparison: ScenarioComparisonResponse | undefined,
  _horizonMonths: number
): { monthly: number; annual: number } {
  return { monthly: 0, annual: 0 };
}
