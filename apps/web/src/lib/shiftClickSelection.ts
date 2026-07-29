/**
 * Shift-click range helpers for checkbox multi-select lists.
 * Shift+click selects every item between the last clicked (anchor) and the target.
 */

export function sliceIdsByAnchor<T>(ordered: readonly T[], anchor: T, target: T): T[] {
  const ai = ordered.indexOf(anchor);
  const ti = ordered.indexOf(target);
  if (ti < 0) return [];
  if (ai < 0) return [target];
  const lo = Math.min(ai, ti);
  const hi = Math.max(ai, ti);
  return ordered.slice(lo, hi + 1) as T[];
}

/** Selection key for a ledger row (resolved txn or projection-only rule occurrence). */
export function ledgerRowSelectionKey(row: {
  transactionId?: number | null;
  date: string;
  accountId?: number | null;
  source: { rule_id?: number | null };
}): string | null {
  if (row.transactionId != null) return `txn:${row.transactionId}`;
  if (row.source.rule_id == null || row.accountId == null || !row.date) return null;
  return `rule:${row.source.rule_id}:${row.accountId}:${row.date}`;
}
