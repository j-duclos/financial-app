/** Bounded history preview on mobile Automation Detail — not a transaction browser. */
export const ACTIVITY_PREVIEW_SIZE = 5;

/** Newest historical first, matching backend default list ordering. */
export const ACTIVITY_PREVIEW_ORDERING = "-date,-id";

export function historicalRuleActivityListParams(ruleId: number, today: string) {
  return {
    rule_id: ruleId,
    page: 1,
    page_size: ACTIVITY_PREVIEW_SIZE,
    date_before: today,
    ordering: ACTIVITY_PREVIEW_ORDERING,
    show_reconciled: true as const,
  };
}

/** Recent activity is historical only: date <= today. Future Planned rows are excluded. */
export function isHistoricalRuleActivityDate(date: string, today: string): boolean {
  return date.slice(0, 10) <= today;
}

export function sortRuleActivityNewestFirst<T extends { date: string; id: number }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const byDate = b.date.slice(0, 10).localeCompare(a.date.slice(0, 10));
    if (byDate !== 0) return byDate;
    return b.id - a.id;
  });
}

export function previewHistoricalRuleActivity<T extends { date: string; id: number }>(
  transactions: T[],
  today: string,
  limit = ACTIVITY_PREVIEW_SIZE
): T[] {
  const historical = transactions.filter((txn) => isHistoricalRuleActivityDate(txn.date, today));
  return sortRuleActivityNewestFirst(historical).slice(0, limit);
}

export function hasAdditionalRuleActivity(page: {
  count?: number;
  next?: string | null;
  results: unknown[];
}): boolean {
  if (page.next) return true;
  if (typeof page.count === "number" && page.count > ACTIVITY_PREVIEW_SIZE) return true;
  return page.results.length > ACTIVITY_PREVIEW_SIZE;
}

export function transactionsForAutomationRule(input: {
  ruleId: number;
  accountId: number;
  dateFrom: string;
  dateTo: string;
}) {
  return {
    pathname: "/(app)/(tabs)/transactions" as const,
    params: {
      account: String(input.accountId),
      rule: String(input.ruleId),
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      showReconciled: "1",
    },
  };
}
