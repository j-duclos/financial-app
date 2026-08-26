import type { Account, RecurringRule, Transaction } from "@budget-app/shared";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import { formatDateDisplay } from "@/lib/dates";
import { getNextRuleRunDate } from "./ruleOccurrences";

export const AUTOMATION_PAGE_INTRO =
  "Rules that automatically create or manage financial activity — income, bills, subscriptions, and transfers.";

export const RULE_SECTIONS = [
  { key: "income", label: "Income" },
  { key: "bills", label: "Bills" },
  { key: "credit_card_charges", label: "Credit card charges" },
  { key: "card_loan_payments", label: "Credit card / loan payments" },
  { key: "transfers", label: "Transfers" },
  { key: "subscriptions", label: "Subscriptions" },
] as const;

export type RuleSectionKey = (typeof RULE_SECTIONS)[number]["key"];

export type RuleLifecycleStatus = "running" | "paused" | "ended";

const SUBSCRIPTION_CATEGORY_NAMES = new Set(["Streaming", "Software / Apps", "Memberships"]);

const CARD_LOAN_PAYMENT_CATEGORY_NAMES = new Set([
  "Credit Card Payment",
  "Student Loan",
  "Personal Loan",
]);

const TRANSFER_CATEGORY_NAMES = new Set(["Bank Transfer", "Transfer"]);

const WEEKDAYS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

const NTH = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
];

export function isCreditCardAccount(account: Pick<Account, "account_type"> | null | undefined): boolean {
  return String(account?.account_type ?? "").toUpperCase() === "CREDIT";
}

export function isCreditCardExpenseRule(rule: RecurringRule): boolean {
  return rule.direction === "EXPENSE" && isCreditCardAccount(rule.account);
}

export function getRuleSection(rule: RecurringRule): RuleSectionKey {
  if (rule.direction === "INCOME") return "income";
  const catName = rule.category?.name ?? "";
  const hasTransferDest = !!(rule.transfer_to_account?.id ?? rule.transfer_to_account_id);
  const nameLower = (rule.name ?? "").toLowerCase();
  if (CARD_LOAN_PAYMENT_CATEGORY_NAMES.has(catName)) return "card_loan_payments";
  if (
    rule.direction === "TRANSFER" ||
    hasTransferDest ||
    TRANSFER_CATEGORY_NAMES.has(catName) ||
    nameLower.includes("move to")
  ) {
    return "transfers";
  }
  if (isCreditCardExpenseRule(rule)) return "credit_card_charges";
  if (SUBSCRIPTION_CATEGORY_NAMES.has(catName)) return "subscriptions";
  return "bills";
}

export function ruleMonthlyAmount(rule: RecurringRule): number {
  const amount = Math.abs(Number(rule.amount) || 0);
  const interval = Math.max(1, Number(rule.interval) || 1);
  let perMonth: number;
  switch (rule.frequency) {
    case "WEEKLY":
      perMonth = (52 / 12 / interval) * amount;
      break;
    case "BIWEEKLY":
      perMonth = (26 / 12 / interval) * amount;
      break;
    case "MONTHLY_DAY":
    case "MONTHLY_NTH_WEEKDAY":
      perMonth = amount / interval;
      break;
    case "YEARLY":
      perMonth = amount / (12 * interval);
      break;
    default:
      perMonth = amount / interval;
  }
  return rule.direction === "EXPENSE" ? -perMonth : perMonth;
}

export function ruleCountsTowardMonthlyCashFlow(rule: RecurringRule): boolean {
  const section = getRuleSection(rule);
  if (section === "transfers" || section === "credit_card_charges") return false;
  return true;
}

export function sectionMonthlySubtotal(
  rules: RecurringRule[],
  isRunning: (rule: RecurringRule) => boolean
): number {
  return rules.reduce((sum, rule) => {
    if (!isRunning(rule)) return sum;
    return sum + ruleMonthlyAmount(rule);
  }, 0);
}

export function estimatedMonthlyCashFlow(
  rules: RecurringRule[],
  isRunning: (rule: RecurringRule) => boolean
): number {
  return rules.reduce((sum, rule) => {
    if (!isRunning(rule)) return sum;
    if (!ruleCountsTowardMonthlyCashFlow(rule)) return sum;
    return sum + ruleMonthlyAmount(rule);
  }, 0);
}

export function getRuleLifecycleStatus(rule: RecurringRule, today: string): RuleLifecycleStatus {
  const end = rule.end_date?.slice(0, 10);
  if (end && end < today) return "ended";
  if (!rule.active) return "paused";
  return "running";
}

export function lifecycleStatusLabel(status: RuleLifecycleStatus): string {
  if (status === "running") return "Running";
  if (status === "paused") return "Paused";
  return "Ended";
}

export function lifecycleStatusTone(status: RuleLifecycleStatus): "positive" | "warning" | "neutral" {
  if (status === "running") return "positive";
  if (status === "paused") return "warning";
  return "neutral";
}

export function lifecycleToActiveAndEndDate(
  status: RuleLifecycleStatus,
  endDate: string,
  today: string
): { active: boolean; end_date: string | null } {
  if (status === "running") {
    return { active: true, end_date: endDate && endDate >= today ? endDate : null };
  }
  if (status === "paused") {
    return { active: false, end_date: endDate || null };
  }
  const endedOn = endDate && endDate <= today ? endDate : today;
  return { active: false, end_date: endedOn };
}

export function cadenceSummary(rule: RecurringRule): string {
  const f = rule.frequency;
  if (f === "WEEKLY") {
    const weeks = Math.max(1, Number(rule.interval) || 1);
    return `Every ${weeks} ${weeks === 1 ? "week" : "weeks"} on ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  }
  if (f === "BIWEEKLY") {
    const weeks = Math.max(1, Number(rule.interval) || 1) * 2;
    return `Every ${weeks} ${weeks === 1 ? "week" : "weeks"} on ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  }
  if (f === "MONTHLY_DAY") return `Monthly on day ${rule.day_of_month ?? "?"}`;
  if (f === "MONTHLY_NTH_WEEKDAY") {
    return `Monthly on ${NTH.find((n) => n.value === rule.nth_week)?.label ?? "?"} ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  }
  if (f === "YEARLY") return `Yearly on ${rule.start_date ? formatDateDisplay(rule.start_date) : "?"}`;
  return rule.frequency;
}

export function triggerSummary(rule: RecurringRule): string {
  return `Schedule: ${cadenceSummary(rule)}`;
}

export function actionSummary(rule: RecurringRule): string {
  const amount = formatCurrency(rule.amount, rule.currency);
  if (rule.direction === "INCOME") {
    return `Create income of ${amount} in ${getEffectiveDisplayName(rule.account)}`;
  }
  if (rule.direction === "TRANSFER" || rule.transfer_to_account) {
    const dest = rule.transfer_to_account
      ? getEffectiveDisplayName(rule.transfer_to_account)
      : "destination account";
    return `Transfer ${amount} to ${dest}`;
  }
  const cat = rule.category?.name ? ` (${rule.category.name})` : "";
  return `Create expense of ${amount}${cat}`;
}

export function buildRuleSummary(rule: RecurringRule): string {
  const lifecycle = getRuleLifecycleStatus(rule, new Date().toISOString().slice(0, 10));
  const statusNote = lifecycle !== "running" ? ` (${lifecycleStatusLabel(lifecycle).toLowerCase()})` : "";
  return `${triggerSummary(rule)} → ${actionSummary(rule)}${statusNote}`;
}

export function formatMonthlySubtotal(total: number, currency = "USD"): string {
  if (total === 0) return formatCurrency(0, currency);
  const prefix = total > 0 ? "+" : "-";
  return `${prefix}${formatCurrency(Math.abs(total), currency)}`;
}

export function formatNextRunDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDateDisplay(iso);
}

export type AutomationListRow = {
  rule: RecurringRule;
  lifecycle: RuleLifecycleStatus;
  section: RuleSectionKey;
  triggerSummary: string;
  actionSummary: string;
  cadenceSummary: string;
  nextRun: string | null;
};

export function buildAutomationRows(rules: RecurringRule[], today: string): AutomationListRow[] {
  return rules.map((rule) => {
    const lifecycle = getRuleLifecycleStatus(rule, today);
    return {
      rule,
      lifecycle,
      section: getRuleSection(rule),
      triggerSummary: triggerSummary(rule),
      actionSummary: actionSummary(rule),
      cadenceSummary: cadenceSummary(rule),
      nextRun: lifecycle === "running" ? getNextRuleRunDate(rule, today) : null,
    };
  });
}

export function groupAutomationRows(
  rows: AutomationListRow[],
  search: string
): Record<RuleSectionKey, AutomationListRow[]> {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter((row) => (row.rule.name ?? "").toLowerCase().includes(q))
    : rows;

  const groups: Record<RuleSectionKey, AutomationListRow[]> = {
    income: [],
    bills: [],
    credit_card_charges: [],
    card_loan_payments: [],
    transfers: [],
    subscriptions: [],
  };

  for (const row of filtered) {
    groups[row.section].push(row);
  }

  for (const key of Object.keys(groups) as RuleSectionKey[]) {
    groups[key].sort((a, b) =>
      a.rule.name.localeCompare(b.rule.name, undefined, { sensitivity: "base", numeric: true })
    );
  }

  return groups;
}

export type ExecutionHistoryRow = {
  transaction: Transaction;
  statusLabel: string;
  statusTone: "positive" | "warning" | "neutral" | "critical";
  actionTaken: string;
};

export function buildExecutionHistoryRow(txn: Transaction): ExecutionHistoryRow {
  const source = (txn.source ?? "").toUpperCase();
  const status = (txn.status ?? "").toUpperCase();
  let statusLabel = "Recorded";
  let statusTone: ExecutionHistoryRow["statusTone"] = "positive";

  if (status === "PLANNED") {
    statusLabel = "Planned";
    statusTone = "neutral";
  } else if (txn.reconciled) {
    statusLabel = "Reconciled";
    statusTone = "positive";
  } else if (source === "RULE") {
    statusLabel = "Materialized";
    statusTone = "positive";
  }

  const amount = formatCurrency(txn.amount, txn.account?.currency ?? "USD");
  const actionTaken =
    txn.direction === "INFLOW"
      ? `Income ${amount}`
      : txn.direction === "OUTFLOW"
        ? `Expense ${amount}`
        : `Transaction ${amount}`;

  return { transaction: txn, statusLabel, statusTone, actionTaken };
}
