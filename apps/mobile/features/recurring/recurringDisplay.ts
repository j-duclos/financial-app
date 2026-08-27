import type { RecurringRule, RecurringRuleDirection } from "@budget-app/shared";
import { getEffectiveDisplayName } from "@budget-app/shared";
import type { FinancialTone } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";

export type RecurringSortKey = "next" | "name" | "amount" | "account";

export type RecurringLifecycleStatus = "active" | "paused" | "ended" | "inactive";

export type RecurringListRow = {
  rule: RecurringRule;
  cadenceLabel: string;
  accountLine: string;
  metaLine: string;
  nextOccurrence: string | null;
  isActive: boolean;
  lifecycleStatus: RecurringLifecycleStatus;
  amountDisplay: RecurringAmountDisplay;
};

export type RecurringAmountDisplay = {
  /** Absolute magnitude for formatting. */
  magnitude: number;
  /** Signed value used by CurrencyDisplay when tone follows amount. */
  signed: number;
  tone: FinancialTone;
  showSign: boolean;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NTH = ["1st", "2nd", "3rd", "4th", "5th"];
const NTH_LONG = ["First", "Second", "Third", "Fourth", "Fifth"];
const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
  if (f === "MONTHLY_DAY") {
    const dom = rule.day_of_month ?? "?";
    const ordinal =
      typeof dom === "number"
        ? `${dom}${dom === 1 ? "st" : dom === 2 ? "nd" : dom === 3 ? "rd" : "th"}`
        : `day ${dom}`;
    return `Monthly · ${ordinal}`;
  }
  if (f === "MONTHLY_NTH_WEEKDAY") {
    const nth = NTH[(rule.nth_week ?? 1) - 1] ?? "?";
    const dow = WEEKDAYS[rule.day_of_week ?? 0] ?? "?";
    return `Monthly · ${nth} ${dow}`;
  }
  if (f === "YEARLY") return "Yearly";
  return String(f);
}

/** Human label for monthly-weekday form (e.g. "Second Friday"). */
export function monthlyWeekdayLabel(nthWeek: number | null, dayOfWeek: number | null): string {
  const nth = NTH_LONG[(nthWeek ?? 1) - 1] ?? "First";
  const dow = WEEKDAYS_LONG[dayOfWeek ?? 0] ?? "Monday";
  return `${nth} ${dow}`;
}

export function directionLabel(direction: RecurringRuleDirection): string {
  if (direction === "INCOME") return "Income";
  if (direction === "TRANSFER") return "Transfer";
  return "Expense";
}

export function ruleLifecycleStatus(rule: RecurringRule, today: string): RecurringLifecycleStatus {
  const end = rule.end_date?.slice(0, 10);
  if (end && end < today) return "ended";
  if (!rule.active) {
    if (rule.paused_at) return "paused";
    return "inactive";
  }
  return "active";
}

export function ruleIsActive(rule: RecurringRule, today: string): boolean {
  return ruleLifecycleStatus(rule, today) === "active";
}

/** Presentation amount from canonical direction — not raw storage sign alone. */
export function amountDisplayForRule(rule: RecurringRule): RecurringAmountDisplay {
  const raw = parseFloat(rule.amount);
  const magnitude = Number.isFinite(raw) ? Math.abs(raw) : 0;
  if (rule.direction === "INCOME") {
    return { magnitude, signed: magnitude, tone: "positive", showSign: true };
  }
  if (rule.direction === "EXPENSE") {
    return { magnitude, signed: -magnitude, tone: "negative", showSign: true };
  }
  return { magnitude, signed: magnitude, tone: "neutral", showSign: false };
}

export function accountLineForRule(rule: RecurringRule): string {
  const from = getEffectiveDisplayName(rule.account);
  if (rule.direction === "TRANSFER" && rule.transfer_to_account) {
    return `${from} → ${getEffectiveDisplayName(rule.transfer_to_account)}`;
  }
  if (rule.category?.name) {
    return `${from} · ${rule.category.name}`;
  }
  return from;
}

/**
 * Prefer backend next_occurrence_date (canonical). Checklist is optional enrichment only.
 */
export function resolveNextOccurrence(
  rule: RecurringRule,
  today: string,
  checklistDue: string | null = null
): string | null {
  if (!ruleIsActive(rule, today)) return null;
  const fromApi = rule.next_occurrence_date?.slice(0, 10) ?? null;
  if (fromApi) return fromApi;
  if (checklistDue) return checklistDue.slice(0, 10);
  return null;
}

export function buildRecurringRows(rules: RecurringRule[], today: string): RecurringListRow[] {
  return rules.map((rule) => {
    const lifecycleStatus = ruleLifecycleStatus(rule, today);
    const isActive = lifecycleStatus === "active";
    const nextOccurrence = resolveNextOccurrence(rule, today);
    const cadence = cadenceLabel(rule);
    const nextBit = `Next ${formatRecurringDate(nextOccurrence)}`;
    return {
      rule,
      cadenceLabel: cadence,
      accountLine: accountLineForRule(rule),
      metaLine: `${cadence} · ${nextBit}`,
      nextOccurrence,
      isActive,
      lifecycleStatus,
      amountDisplay: amountDisplayForRule(rule),
    };
  });
}

export function sortRecurringRows(rows: RecurringListRow[], sortKey: RecurringSortKey): RecurringListRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    switch (sortKey) {
      case "name":
        return a.rule.name.localeCompare(b.rule.name);
      case "amount": {
        const diff = b.amountDisplay.magnitude - a.amountDisplay.magnitude;
        if (diff !== 0) return diff;
        return a.rule.name.localeCompare(b.rule.name);
      }
      case "account":
        return (a.rule.account.effective_display_name ?? a.rule.account.name).localeCompare(
          b.rule.account.effective_display_name ?? b.rule.account.name
        );
      case "next":
      default: {
        const aNext = a.nextOccurrence ?? "9999-99-99";
        const bNext = b.nextOccurrence ?? "9999-99-99";
        if (aNext !== bNext) return aNext.localeCompare(bNext);
        return a.rule.name.localeCompare(b.rule.name);
      }
    }
  });
  return sorted;
}

export function formatRecurringDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDateDisplay(iso);
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function lifecycleBadgeLabel(status: RecurringLifecycleStatus): string | null {
  if (status === "paused") return "Paused";
  if (status === "ended") return "Ended";
  if (status === "inactive") return "Inactive";
  return null;
}
