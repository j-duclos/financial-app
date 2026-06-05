import { formatCurrency } from "@budget-app/shared";
import type {
  Account,
  ScenarioComparisonResponse,
  ScenarioCreditUtilizationAtHorizon,
  ScenarioOneTimeEvent,
  ScenarioRuleOverride,
  RecurringRule,
} from "@budget-app/shared";
import { formatDateDisplay } from "./dateDisplay";
import type { PlanIncludeItem } from "./scenarioPlainLanguage";
import { balanceOwed, creditLimitAmount, isDebtPaymentAccount } from "./paymentPlannerDisplay";

export function isAssetAccount(account: Account): boolean {
  return (
    account.account_type === "CHECKING" ||
    account.account_type === "SAVINGS" ||
    account.account_type === "CASH"
  );
}

function parseMetricDelta(
  comparison: ScenarioComparisonResponse | undefined,
  key: string
): number | null {
  const raw = comparison?.metrics?.[key]?.delta;
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw));
  return Number.isNaN(n) ? null : n;
}

function parseRiskDays(
  comparison: ScenarioComparisonResponse | undefined,
  side: "base" | "scenario"
): number {
  const raw = comparison?.metrics?.risk_days?.[side];
  return parseInt(String(raw ?? "0"), 10) || 0;
}

export type DebtPaymentType = "one_time" | "pay_full" | "monthly_increase";

export const DEBT_EVENT_NOTE_PREFIX = "what_if_debt:";
export const DEBT_OVERRIDE_NOTE = "what_if_debt:monthly_increase";
export const DEBT_RECURRING_NOTE = "what_if_debt_recurring";

export function isDebtRecurringPayment(added: {
  direction?: string;
  transfer_to_account?: Account | null;
  transfer_to_account_id?: number | null;
  notes?: string;
}): boolean {
  if (added.notes?.includes(DEBT_RECURRING_NOTE)) return true;
  if (added.direction === "TRANSFER" && added.transfer_to_account) {
    return isDebtPaymentAccount(added.transfer_to_account);
  }
  const destId = added.transfer_to_account_id ?? added.transfer_to_account?.id;
  if (added.direction === "TRANSFER" && destId != null) return true;
  return false;
}

export function recurringDebtFrequencyLabel(
  frequency: string,
  notes?: string
): string {
  if (notes?.includes("twice_monthly_days=")) return "twice monthly";
  switch (frequency) {
    case "WEEKLY":
      return "weekly";
    case "BIWEEKLY":
      return "every 2 weeks";
    case "MONTHLY_DAY":
      return "monthly";
    case "YEARLY":
      return "yearly";
    default:
      return "recurring";
  }
}

export function buildTwiceMonthlyNotes(day1: number, day2: number, userNotes: string): string {
  const parts = [`${DEBT_RECURRING_NOTE}`, `twice_monthly_days=${day1},${day2}`];
  if (userNotes.trim()) parts.push(userNotes.trim());
  return parts.join(" ");
}

export function parseTwiceMonthlyDays(notes: string | undefined): [number, number] | null {
  if (!notes) return null;
  const m = notes.match(/twice_monthly_days=(\d{1,2}),(\d{1,2})/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

export function debtEventNote(type: Exclude<DebtPaymentType, "monthly_increase">): string {
  return `${DEBT_EVENT_NOTE_PREFIX}${type}`;
}

export function isDebtScenarioEvent(ev: ScenarioOneTimeEvent): boolean {
  if (ev.notes?.startsWith(DEBT_EVENT_NOTE_PREFIX)) return true;
  if (ev.direction === "TRANSFER" && ev.transfer_to_account) {
    return isDebtPaymentAccount(ev.transfer_to_account);
  }
  const lower = (ev.description ?? "").toLowerCase();
  return lower.includes("pay off") || lower.includes("debt payment");
}

export function parseDebtEventType(ev: ScenarioOneTimeEvent): DebtPaymentType | null {
  const tagged = ev.notes?.match(/^what_if_debt:(one_time|pay_full)/);
  if (tagged) return tagged[1] as DebtPaymentType;
  if (ev.direction !== "TRANSFER" || !ev.transfer_to_account) return null;
  const amt = parseFloat(ev.amount);
  const owed = balanceOwed(ev.transfer_to_account);
  if (owed != null && owed > 0 && Math.abs(amt - owed) < 0.02) return "pay_full";
  return "one_time";
}

export function isDebtPaymentOverride(ov: ScenarioRuleOverride): boolean {
  if (ov.notes?.includes(DEBT_OVERRIDE_NOTE)) return true;
  const dest = ov.rule?.transfer_to_account;
  return dest != null && isDebtPaymentAccount(dest);
}

export function filterAssetAccounts(accounts: Account[]): Account[] {
  return accounts.filter(isAssetAccount);
}

export function filterDebtAccounts(accounts: Account[]): Account[] {
  return accounts.filter(isDebtPaymentAccount);
}

export function formatDebtBalance(account: Account | undefined): string {
  if (!account) return "—";
  const owed = balanceOwed(account);
  if (owed == null || owed <= 0) return formatCurrency("0", "USD");
  return formatCurrency(String(owed), "USD");
}

export function utilizationPercent(account: Account | undefined): number | null {
  if (!account) return null;
  const limit = creditLimitAmount(account);
  const owed = balanceOwed(account);
  if (limit == null || limit <= 0 || owed == null) return null;
  return Math.round((owed / limit) * 1000) / 10;
}

/** Utilization after a single payment (modal preview only — not end-of-horizon forecast). */
export function projectedUtilizationAfterPayment(
  account: Account | undefined,
  paymentAmount: number
): number | null {
  if (!account) return null;
  const limit = creditLimitAmount(account);
  const owed = balanceOwed(account);
  if (limit == null || limit <= 0 || owed == null) return null;
  const remaining = Math.max(owed - paymentAmount, 0);
  return Math.round((remaining / limit) * 1000) / 10;
}

export function formatUtilizationLine(account: Account | undefined): string | null {
  const pct = utilizationPercent(account);
  if (pct == null) return null;
  return `${pct}%`;
}

/** Same categories as Rules → Credit Card / Loan Payment section. */
export const DEBT_PAYMENT_RULE_CATEGORIES = new Set([
  "Credit Card Payment",
  "Student Loan",
  "Personal Loan",
]);

function ruleTransferDestId(rule: RecurringRule): number | null {
  const id = rule.transfer_to_account_id ?? rule.transfer_to_account?.id;
  return id != null ? Number(id) : null;
}

/** Whether a recurring rule pays down the given debt account (matches Rules UI + ledger). */
export function rulePaysDebtAccount(rule: RecurringRule, debtAccount: Account): boolean {
  const destId = ruleTransferDestId(rule);
  if (destId != null) return destId === debtAccount.id;

  const catName = rule.category?.name ?? "";
  if (!DEBT_PAYMENT_RULE_CATEGORIES.has(catName)) return false;

  const debtName = (debtAccount.name ?? "").trim().toLowerCase();
  const ruleName = (rule.name ?? "").trim().toLowerCase();
  if (!debtName || debtName.length < 3) return false;

  return ruleName.includes(debtName);
}

export function findDebtPaymentRules(
  rules: RecurringRule[],
  debtAccountId: number,
  accounts: Account[] = []
): RecurringRule[] {
  const debtAccount = accounts.find((a) => a.id === debtAccountId);
  return rules
    .filter((r) => {
      if (!r.active) return false;
      if (debtAccount) return rulePaysDebtAccount(r, debtAccount);
      return ruleTransferDestId(r) === debtAccountId;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function oneTimeDebtDescription(
  type: "one_time" | "pay_full",
  sourceName: string,
  debtName: string
): string {
  if (type === "pay_full") {
    return `Pay off ${debtName} in full using ${sourceName}`;
  }
  return `Debt payment from ${sourceName} to ${debtName}`;
}

export function monthlyIncreaseSummary(
  debtName: string,
  fromAmount: string,
  toAmount: string,
  currency: string,
  effectiveDate: string
): string {
  const from = formatCurrency(fromAmount, currency);
  const to = formatCurrency(toAmount, currency);
  return `Increase ${debtName} payment from ${from}/mo to ${to}/mo starting ${formatDateDisplay(effectiveDate)}.`;
}

/** Credit card named in a debt plan item (destination of transfer / payment). */
export function debtTargetAccountName(item: PlanIncludeItem): string | null {
  if (item.accountLabel?.includes("→")) {
    const parts = item.accountLabel.split("→").map((s) => s.trim());
    if (parts.length === 2) return parts[1];
  }
  if (item.impactKind === "debt") return item.title;
  return null;
}

/** Human-readable utilization at end of the scenario forecast window. */
export function formatUtilizationAtHorizonLine(
  entry: ScenarioCreditUtilizationAtHorizon,
  endDate: string
): string {
  const end = formatDateDisplay(endDate);
  const base = parseFloat(entry.base_utilization_percent);
  const scenario = parseFloat(entry.scenario_utilization_percent);
  const name = entry.account_name;
  if (!Number.isNaN(scenario) && scenario <= 0.05) {
    return `by ${end}, ${name} is paid off (was ${base}% utilization)`;
  }
  return `by ${end}, ${name} utilization ${base}% → ${scenario}%`;
}

export function utilizationHorizonSuffix(
  item: PlanIncludeItem,
  comparison: ScenarioComparisonResponse | undefined
): string | null {
  if (item.impactKind !== "debt" || !comparison?.end_date) return null;
  const name = debtTargetAccountName(item);
  if (!name) return null;
  const entry = comparison.credit_utilization_at_horizon?.find((e) => e.account_name === name);
  if (!entry) return null;
  return formatUtilizationAtHorizonLine(entry, comparison.end_date);
}

/** Aggregate debt/cash highlights (per-change lines are built separately). */
export function buildDebtImpactHighlights(
  comparison: ScenarioComparisonResponse | undefined,
  planItems: PlanIncludeItem[]
): string[] {
  const hasDebt = planItems.some((i) => i.impactKind === "debt");
  if (!hasDebt || !comparison?.metrics) return [];

  const lines: string[] = [];
  const debtDelta = parseMetricDelta(comparison, "credit_debt_after_horizon");
  if (debtDelta != null && debtDelta < -0.005) {
    lines.push(
      `Total credit debt drops by ${formatCurrency(String(Math.abs(debtDelta)), "USD")} by end of this period`
    );
  }

  const baseRisk = parseRiskDays(comparison, "base");
  const scenarioRisk = parseRiskDays(comparison, "scenario");
  if (baseRisk > 0 && scenarioRisk < baseRisk) {
    const removed = baseRisk - scenarioRisk;
    if (removed === 1) {
      lines.push("Removes one forecast risk day");
    } else if (removed > 1) {
      lines.push(`Removes ${removed} forecast risk days`);
    }
  }

  const lowestDelta = parseMetricDelta(comparison, "lowest_projected_balance");
  if (lowestDelta != null && lowestDelta > 0.005) {
    lines.push(
      `Lowest forecast balance increases by ${formatCurrency(String(lowestDelta), "USD")}`
    );
  }

  return [...new Set(lines)];
}
