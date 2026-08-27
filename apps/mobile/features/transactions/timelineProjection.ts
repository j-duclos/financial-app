import { todayStr } from "@/lib/dates";
import type { TransactionFilters } from "./types";

/**
 * Whether the Transactions screen needs forward timeline projection data.
 * Skips expensive forecast when the active view is historical/posted-only.
 */
export function needsTimelineProjection(
  filters: TransactionFilters,
  today: string = todayStr()
): boolean {
  if (filters.forecast === "posted") return false;
  if (filters.specificDate && filters.specificDate < today) return false;
  if (filters.dateTo && filters.dateTo < today && !filters.dateFrom) return false;
  if (filters.dateFrom && filters.dateTo && filters.dateTo < today) return false;
  return true;
}
