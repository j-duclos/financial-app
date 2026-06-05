import type { BillChecklistItem, RecurringRule } from "@budget-app/shared";
import { formatDueDateShort } from "./billsDisplay";
import { getNextRuleRunDate } from "./ruleOccurrences";

export type RecurringGroupKey =
  | "subscriptions"
  | "utilities"
  | "loans"
  | "credit_cards"
  | "insurance"
  | "transfers"
  | "income";

export const RECURRING_GROUP_ORDER: { key: RecurringGroupKey; label: string }[] = [
  { key: "subscriptions", label: "Subscriptions" },
  { key: "utilities", label: "Utilities" },
  { key: "loans", label: "Loans" },
  { key: "credit_cards", label: "Credit cards" },
  { key: "insurance", label: "Insurance" },
  { key: "transfers", label: "Transfers" },
  { key: "income", label: "Income" },
];

export type RecurringPaymentStatus =
  | "scheduled"
  | "due_soon"
  | "paid"
  | "missed"
  | "skipped"
  | "paused"
  | "inactive";

/** @deprecated Use RecurringPaymentStatus — kept for filter migration only */
export type RecurringHealthStatus = RecurringPaymentStatus;

const SUBSCRIPTION_CATEGORY_NAMES = new Set(["Streaming", "Software / Apps", "Memberships"]);
const UTILITY_CATEGORY_NAMES = new Set([
  "Electric",
  "Gas",
  "Water",
  "Internet",
  "Phone",
  "Utilities",
  "Cable",
]);
const LOAN_CATEGORY_NAMES = new Set([
  "Student Loan",
  "Personal Loan",
  "Auto Loan",
  "Mortgage",
  "Home Loan",
]);
const INSURANCE_CATEGORY_NAMES = new Set([
  "Insurance",
  "Health Insurance",
  "Auto Insurance",
  "Home Insurance",
  "Life Insurance",
]);
const CARD_PAYMENT_CATEGORY_NAMES = new Set(["Credit Card Payment"]);
const TRANSFER_CATEGORY_NAMES = new Set(["Bank Transfer", "Transfer"]);

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NTH = ["1st", "2nd", "3rd", "4th", "5th"];

export function formatDayOfMonthOrdinal(day: number | null | undefined): string {
  if (day == null || !Number.isFinite(day) || day < 1 || day > 31) return "?";
  const n = Math.trunc(day);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

export type RecurringListItem = {
  rule: RecurringRule;
  occurrence: BillChecklistItem | null;
  group: RecurringGroupKey;
  paymentStatus: RecurringPaymentStatus;
  dayOfMonth: number;
  cadenceLabel: string;
  categorySubtitle: string;
  averageAmount: string | null;
  nextOccurrence: string | null;
  lastPaidDate: string | null;
  confidence: "high" | "medium" | "low" | null;
  autopayLabel: string | null;
  trend: "stable" | "up" | "down" | "unknown";
};

export type RecurringSummary = {
  activeRules: number;
  monthlyRecurringTotal: number;
  upcomingCount: number;
  missedCount: number;
  dueSoonCount: number;
};

const DUE_SOON_DAYS = 5;

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ruleIsRunning(rule: RecurringRule, today = todayLocalISO()): boolean {
  const end = rule.end_date?.slice(0, 10);
  if (end && end < today) return false;
  return rule.active;
}

export function getRecurringGroup(rule: RecurringRule): RecurringGroupKey {
  if (rule.direction === "INCOME") return "income";
  const catName = rule.category?.name ?? "";
  const hasTransferDest = !!(rule.transfer_to_account?.id ?? rule.transfer_to_account_id);
  const nameLower = (rule.name ?? "").toLowerCase();
  if (CARD_PAYMENT_CATEGORY_NAMES.has(catName)) return "credit_cards";
  if (LOAN_CATEGORY_NAMES.has(catName)) return "loans";
  if (INSURANCE_CATEGORY_NAMES.has(catName)) return "insurance";
  if (
    rule.direction === "TRANSFER" ||
    hasTransferDest ||
    TRANSFER_CATEGORY_NAMES.has(catName) ||
    nameLower.includes("move to")
  ) {
    return "transfers";
  }
  if (SUBSCRIPTION_CATEGORY_NAMES.has(catName)) return "subscriptions";
  if (UTILITY_CATEGORY_NAMES.has(catName)) return "utilities";
  if (rule.direction === "EXPENSE") return "utilities";
  return "utilities";
}

export function cadenceLabel(rule: RecurringRule): string {
  const f = rule.frequency;
  if (f === "WEEKLY") {
    const weeks = Math.max(1, Number(rule.interval) || 1);
    const dow = WEEKDAYS[rule.day_of_week ?? 0] ?? "?";
    return weeks === 1 ? `Weekly · ${dow}` : `Every ${weeks} weeks · ${dow}`;
  }
  if (f === "BIWEEKLY") {
    const weeks = Math.max(1, Number(rule.interval) || 1) * 2;
    const dow = WEEKDAYS[rule.day_of_week ?? 0] ?? "?";
    return `Every ${weeks} weeks · ${dow}`;
  }
  if (f === "MONTHLY_DAY") return `Monthly · ${formatDayOfMonthOrdinal(rule.day_of_month)}`;
  if (f === "MONTHLY_NTH_WEEKDAY") {
    const nth = NTH[(rule.nth_week ?? 1) - 1] ?? "?";
    const dow = WEEKDAYS[rule.day_of_week ?? 0] ?? "?";
    return `Monthly · ${nth} ${dow}`;
  }
  if (f === "YEARLY") return "Yearly";
  return f.replace(/_/g, " ").toLowerCase();
}

function ruleMonthlyExpenseAmount(rule: RecurringRule): number {
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
  return rule.direction === "EXPENSE" ? perMonth : 0;
}

function amountTrend(
  rule: RecurringRule,
  occurrence: BillChecklistItem | null
): RecurringListItem["trend"] {
  const avg = occurrence?.average_amount ? parseFloat(occurrence.average_amount) : null;
  const current = occurrence?.amount
    ? parseFloat(occurrence.amount)
    : rule.amount
      ? parseFloat(rule.amount)
      : null;
  if (avg == null || current == null || avg === 0) return "unknown";
  const pct = ((current - avg) / avg) * 100;
  if (Math.abs(pct) < 5) return "stable";
  return pct > 0 ? "up" : "down";
}

function occurrenceHasVerifiedPayment(occurrence: BillChecklistItem): boolean {
  const linked =
    occurrence.matched_transaction_id != null || occurrence.transaction_id != null;
  const settled = occurrence.status === "paid" || occurrence.status === "reconciled";
  return settled || linked;
}

function daysUntilDue(dueDate: string, today: string): number {
  const due = new Date(`${dueDate.slice(0, 10)}T12:00:00`);
  const now = new Date(`${today.slice(0, 10)}T12:00:00`);
  return Math.round((due.getTime() - now.getTime()) / 86_400_000);
}

function paymentStatusForDueDate(dueDate: string, today: string): RecurringPaymentStatus {
  const days = daysUntilDue(dueDate, today);
  if (days < 0) return "missed";
  if (days <= DUE_SOON_DAYS) return "due_soon";
  return "scheduled";
}

function occurrenceIsSettled(occurrence: BillChecklistItem): boolean {
  return (
    occurrence.skipped ||
    occurrence.status === "paid" ||
    occurrence.status === "reconciled"
  );
}

/** Next scheduled charge — advances past a settled occurrence instead of repeating its due date. */
export function resolveRecurringNextOccurrence(
  rule: RecurringRule,
  occurrence: BillChecklistItem | null,
  today = todayLocalISO()
): string | null {
  if (!ruleIsRunning(rule, today)) return null;
  if (occurrence && !occurrenceIsSettled(occurrence)) {
    return occurrence.due_date;
  }
  return getNextRuleRunDate(rule, today);
}

/** Most recent paid date for this rule from checklist rows (current occurrence or history). */
export function resolveRecurringLastPaidDate(
  checklistItems: BillChecklistItem[],
  ruleId: number,
  occurrence: BillChecklistItem | null
): string | null {
  if (occurrence?.paid_date) return occurrence.paid_date;
  const paidRows = checklistItems
    .filter(
      (item) =>
        item.rule_id === ruleId &&
        (item.status === "paid" || item.status === "reconciled") &&
        item.paid_date
    )
    .sort((a, b) => b.paid_date!.localeCompare(a.paid_date!));
  return paidRows[0]?.paid_date ?? null;
}

export function recurringDayOfMonth(rule: RecurringRule, nextOccurrence: string | null): number {
  if (rule.frequency === "MONTHLY_DAY" && rule.day_of_month) {
    return rule.day_of_month;
  }
  if (nextOccurrence) {
    return parseInt(nextOccurrence.slice(8, 10), 10);
  }
  return 32;
}

export function deriveRecurringPaymentStatus(
  rule: RecurringRule,
  occurrence: BillChecklistItem | null,
  today = todayLocalISO()
): RecurringPaymentStatus {
  if (!ruleIsRunning(rule, today)) {
    const end = rule.end_date?.slice(0, 10);
    if (!rule.active || rule.paused_at) return "paused";
    if (end && end < today) return "inactive";
    return "paused";
  }

  if (occurrence?.skipped || occurrence?.status === "skipped") {
    return "skipped";
  }

  if (occurrence && occurrenceHasVerifiedPayment(occurrence)) {
    // Past cycle is settled — status follows the upcoming charge, not the old payment.
    if (occurrence.due_date < today) {
      const nextDue = getNextRuleRunDate(rule, today);
      if (!nextDue) return "paid";
      return paymentStatusForDueDate(nextDue, today);
    }
    return "paid";
  }

  const dueDate =
    occurrence?.due_date ?? (ruleIsRunning(rule, today) ? getNextRuleRunDate(rule, today) : null);
  if (!dueDate) return "scheduled";

  if (
    occurrence &&
    (occurrence.status === "late" ||
      occurrence.status === "missed" ||
      occurrence.status === "likely_forgotten")
  ) {
    return "missed";
  }

  return paymentStatusForDueDate(dueDate, today);
}

/** @deprecated Use deriveRecurringPaymentStatus */
export function deriveRecurringHealth(
  rule: RecurringRule,
  occurrence: BillChecklistItem | null,
  _allRules: RecurringRule[]
): RecurringPaymentStatus {
  return deriveRecurringPaymentStatus(rule, occurrence);
}

export function groupRecurringItemsByDay(
  items: RecurringListItem[]
): { day: number; label: string; items: RecurringListItem[] }[] {
  const map = new Map<number, RecurringListItem[]>();
  for (const item of items) {
    const bucket = map.get(item.dayOfMonth) ?? [];
    bucket.push(item);
    map.set(item.dayOfMonth, bucket);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, sectionItems]) => ({
      day,
      label: day <= 31 ? formatDayOfMonthOrdinal(day) : "Other",
      items: sectionItems.sort((a, b) => a.rule.name.localeCompare(b.rule.name)),
    }));
}

/** Best checklist row to match a ledger transaction for a recurring rule. */
export function pickChecklistOccurrenceForRule(
  checklistItems: BillChecklistItem[],
  ruleId: number,
  todayIso: string
): BillChecklistItem | null {
  const forRule = checklistItems.filter((item) => item.rule_id === ruleId);
  if (forRule.length === 0) return null;

  const isSettled = (item: BillChecklistItem) =>
    item.skipped || item.status === "paid" || item.status === "reconciled";

  const unpaid = forRule.filter((item) => !isSettled(item));
  const pool = unpaid.length > 0 ? unpaid : forRule;

  const pastDue = pool.filter((item) => item.due_date <= todayIso);
  if (pastDue.length > 0) {
    return [...pastDue].sort((a, b) => b.due_date.localeCompare(a.due_date))[0];
  }

  return [...pool].sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
}

export function buildRecurringListItems(
  rules: RecurringRule[],
  checklistItems: BillChecklistItem[]
): RecurringListItem[] {
  const today = todayLocalISO();
  const byRuleId = new Map<number, BillChecklistItem>();
  for (const item of checklistItems) {
    if (item.rule_id != null) {
      const picked = pickChecklistOccurrenceForRule(checklistItems, item.rule_id, today);
      if (picked) byRuleId.set(item.rule_id, picked);
    }
  }

  const horizonEnd = new Date(today);
  horizonEnd.setDate(horizonEnd.getDate() + 30);
  const horizonISO = horizonEnd.toISOString().slice(0, 10);

  return rules.map((rule) => {
    const occurrence = byRuleId.get(rule.id) ?? null;
    const group = getRecurringGroup(rule);
    const nextOccurrence = resolveRecurringNextOccurrence(rule, occurrence, today);
    const paymentStatus = deriveRecurringPaymentStatus(rule, occurrence, today);
    const lastPaidDate = resolveRecurringLastPaidDate(checklistItems, rule.id, occurrence);
    const confidence =
      occurrence?.payment_confidence ??
      (occurrence?.autopay_confidence as RecurringListItem["confidence"]) ??
      null;

    return {
      rule,
      occurrence,
      group,
      paymentStatus,
      dayOfMonth: recurringDayOfMonth(rule, nextOccurrence),
      cadenceLabel: cadenceLabel(rule),
      categorySubtitle: rule.category?.name ?? groupLabel(group),
      averageAmount: occurrence?.average_amount ?? rule.amount ?? null,
      nextOccurrence:
        nextOccurrence && nextOccurrence <= horizonISO ? nextOccurrence : nextOccurrence,
      lastPaidDate,
      confidence,
      autopayLabel: occurrence?.autopay_label ?? null,
      trend: amountTrend(rule, occurrence),
    };
  });
}

function groupLabel(key: RecurringGroupKey): string {
  return RECURRING_GROUP_ORDER.find((g) => g.key === key)?.label ?? key;
}

export function computeRecurringSummary(items: RecurringListItem[]): RecurringSummary {
  const today = todayLocalISO();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 30);
  const horizonISO = horizon.toISOString().slice(0, 10);

  let activeRules = 0;
  let monthlyRecurringTotal = 0;
  let upcomingCount = 0;
  let missedCount = 0;
  let dueSoonCount = 0;

  for (const item of items) {
    if (ruleIsRunning(item.rule, today)) {
      activeRules += 1;
      monthlyRecurringTotal += ruleMonthlyExpenseAmount(item.rule);
      if (item.nextOccurrence && item.nextOccurrence >= today && item.nextOccurrence <= horizonISO) {
        upcomingCount += 1;
      }
    }
    if (item.paymentStatus === "missed") missedCount += 1;
    if (item.paymentStatus === "due_soon") dueSoonCount += 1;
  }

  return {
    activeRules,
    monthlyRecurringTotal,
    upcomingCount,
    missedCount,
    dueSoonCount,
  };
}

export function recurringPaymentStatusLabel(status: RecurringPaymentStatus): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "due_soon":
      return "Due soon";
    case "paid":
      return "Paid";
    case "missed":
      return "Missed";
    case "skipped":
      return "Skipped";
    case "paused":
      return "Paused";
    case "inactive":
      return "Inactive";
  }
}

export function recurringPaymentStatusBadgeClass(status: RecurringPaymentStatus): string {
  switch (status) {
    case "scheduled":
      return "bg-gray-100 text-gray-700";
    case "due_soon":
      return "bg-amber-50 text-amber-900";
    case "paid":
      return "bg-emerald-50 text-emerald-800";
    case "missed":
      return "bg-red-100 text-red-800";
    case "skipped":
      return "bg-gray-50 text-gray-500";
    case "paused":
      return "bg-gray-100 text-gray-600";
    case "inactive":
      return "bg-gray-50 text-gray-500";
  }
}

/** Solid left accent bar — use on a dedicated element, not border-l (unreliable on stacked rows). */
export function recurringPaymentRowAccentClass(status: RecurringPaymentStatus): string {
  switch (status) {
    case "missed":
      return "bg-red-500";
    case "due_soon":
      return "bg-amber-400";
    case "paid":
      return "bg-emerald-500";
    case "skipped":
    case "paused":
    case "inactive":
      return "bg-gray-300";
    case "scheduled":
      return "bg-slate-300";
    default:
      return "bg-slate-300";
  }
}

/** Row surface tint paired with {@link recurringPaymentRowAccentClass}. */
export function recurringPaymentRowClass(status: RecurringPaymentStatus): string {
  switch (status) {
    case "missed":
      return "bg-red-50/60";
    case "due_soon":
      return "bg-amber-50/40";
    case "paid":
      return "bg-emerald-50/30";
    case "skipped":
    case "paused":
    case "inactive":
      return "bg-gray-50/80 opacity-90";
    default:
      return "bg-white";
  }
}

/** @deprecated Use recurringPaymentStatusLabel */
export function recurringHealthLabel(status: RecurringPaymentStatus): string {
  return recurringPaymentStatusLabel(status);
}

/** @deprecated Use recurringPaymentStatusBadgeClass */
export function recurringHealthBadgeClass(status: RecurringPaymentStatus): string {
  return recurringPaymentStatusBadgeClass(status);
}

/** @deprecated Use recurringPaymentRowClass */
export function recurringRowClass(status: RecurringPaymentStatus): string {
  return recurringPaymentRowClass(status);
}

export function recurringConfidenceLabel(level: string | null | undefined): string {
  if (level === "high") return "High";
  if (level === "medium") return "Medium";
  if (level === "low") return "Low";
  return "—";
}

export function recurringTrendLabel(trend: RecurringListItem["trend"]): string {
  switch (trend) {
    case "up":
      return "↑ vs avg";
    case "down":
      return "↓ vs avg";
    case "stable":
      return "Stable";
    default:
      return "";
  }
}

export function formatRecurringDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDueDateShort(iso);
}

export type RecurringBillPaymentRow = {
  id: number;
  date: string;
  amount: string;
  payee: string;
};

/** Past vs upcoming rule-linked payments, each sorted ascending by date. */
export function splitRecurringBillPayments(
  payments: RecurringBillPaymentRow[],
  todayIso: string
): { history: RecurringBillPaymentRow[]; forecast: RecurringBillPaymentRow[] } {
  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date));
  const history: RecurringBillPaymentRow[] = [];
  const forecast: RecurringBillPaymentRow[] = [];
  for (const payment of sorted) {
    if (payment.date > todayIso) forecast.push(payment);
    else history.push(payment);
  }
  return { history, forecast };
}
