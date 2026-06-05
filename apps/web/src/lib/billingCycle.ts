/** Map day-of-month to a calendar date; day 31 in February → last day of month. */
function dayInMonth(year: number, month: number, day: number): string {
  const d = Math.max(1, Math.min(31, Math.floor(day)));
  const last = new Date(year, month, 0).getDate();
  const dom = Math.min(d, last);
  const m = String(month).padStart(2, "0");
  const dd = String(dom).padStart(2, "0");
  return `${year}-${m}-${dd}`;
}

/** Next billing cycle end on or after today (YYYY-MM-DD). */
export function nextBillingCycleEndDate(closingDay: number, today = new Date()): string {
  const day = Math.max(1, Math.min(31, Math.floor(closingDay)));
  let y = today.getFullYear();
  let m = today.getMonth() + 1;
  let candidate = dayInMonth(y, m, day);
  const todayStr = dayInMonth(y, m, today.getDate());
  if (candidate < todayStr) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    candidate = dayInMonth(y, m, day);
  }
  return candidate;
}
