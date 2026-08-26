import type { BillChecklistItem, RecurringRule } from "@budget-app/shared";
import { formatDateDisplay } from "@/lib/dates";

export type RecurringSortKey = "next" | "name" | "amount" | "account";

export type RecurringListRow = {
  rule: RecurringRule;
  occurrence: BillChecklistItem | null;
  cadenceLabel: string;
  nextOccurrence: string | null;
  isActive: boolean;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NTH = ["1st", "2nd", "3rd", "4th", "5th"];

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
    return `Monthly · day ${dom}`;
  }
  if (f === "MONTHLY_NTH_WEEKDAY") {
    const nth = NTH[(rule.nth_week ?? 1) - 1] ?? "?";
    const dow = WEEKDAYS[rule.day_of_week ?? 0] ?? "?";
    return `Monthly · ${nth} ${dow}`;
  }
  if (f === "YEARLY") return "Yearly";
  return String(f);
}

export function directionLabel(direction: RecurringRule["direction"]): string {
  if (direction === "INCOME") return "Income";
  if (direction === "TRANSFER") return "Transfer";
  return "Expense";
}

export function ruleIsActive(rule: RecurringRule, today: string): boolean {
  if (!rule.active) return false;
  const end = rule.end_date?.slice(0, 10);
  if (end && end < today) return false;
  return true;
}

export function buildRecurringRows(
  rules: RecurringRule[],
  checklistItems: BillChecklistItem[],
  today: string
): RecurringListRow[] {
  const byRule = new Map<number, BillChecklistItem>();
  for (const item of checklistItems) {
    if (item.rule_id == null) continue;
    const existing = byRule.get(item.rule_id);
    if (!existing || item.due_date < existing.due_date) {
      byRule.set(item.rule_id, item);
    }
  }

  return rules.map((rule) => {
    const occurrence = byRule.get(rule.id) ?? null;
    return {
      rule,
      occurrence,
      cadenceLabel: cadenceLabel(rule),
      nextOccurrence: occurrence?.due_date ?? null,
      isActive: ruleIsActive(rule, today),
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
      case "amount":
        return Math.abs(parseFloat(b.rule.amount)) - Math.abs(parseFloat(a.rule.amount));
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
