/**
 * Month grouping for timeline and upcoming lists (navigation only — no financial logic).
 */

export type MonthGroup<T> = {
  monthKey: string;
  monthLabel: string;
  items: T[];
};

/** ISO date → YYYY-MM */
export function monthKeyFromIsoDate(isoDate: string): string {
  if (isoDate.length >= 7 && isoDate[4] === "-") {
    return isoDate.slice(0, 7);
  }
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** YYYY-MM → JUNE 2026 */
export function monthLabelFromKey(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  if (!y || !m) return monthKey.toUpperCase();
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthKey.toUpperCase();
  return d.toLocaleString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

/** ISO date → JUNE 2026 */
export function monthLabelFromIsoDate(isoDate: string): string {
  return monthLabelFromKey(monthKeyFromIsoDate(isoDate));
}

/** Accessible label: June 2026 */
export function monthAriaLabelFromKey(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  if (!y || !m) return monthKey;
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export function monthAriaLabelFromIsoDate(isoDate: string): string {
  return monthAriaLabelFromKey(monthKeyFromIsoDate(isoDate));
}

export type MonthGroupOptions<T> = {
  getMonthKey?: (item: T) => string | undefined;
  getMonthLabel?: (item: T) => string | undefined;
};

/**
 * Group sorted items by calendar month, preserving item order within each month.
 */
export function groupItemsByMonth<T>(
  items: T[],
  getDate: (item: T) => string,
  options?: MonthGroupOptions<T>
): MonthGroup<T>[] {
  const map = new Map<string, T[]>();
  const labelByKey = new Map<string, string>();

  for (const item of items) {
    const key = options?.getMonthKey?.(item) ?? monthKeyFromIsoDate(getDate(item));
    const label =
      options?.getMonthLabel?.(item) ??
      labelByKey.get(key) ??
      monthLabelFromKey(key);
    labelByKey.set(key, label);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, monthItems]) => ({
      monthKey,
      monthLabel: labelByKey.get(monthKey) ?? monthLabelFromKey(monthKey),
      items: monthItems,
    }));
}

/** Sticky month headers sit flush with the list scrollport top. */
export const TIMELINE_LIST_MONTH_STICKY_TOP = "top-0";
