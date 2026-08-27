/** Format ISO YYYY-MM-DD (or datetime prefix) for display as MM-DD-YY. */
export function formatDateDisplay(isoDate: string | null | undefined): string {
  if (isoDate == null || isoDate === "") return "—";
  const datePart = isoDate.trim().slice(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return isoDate;
  return `${m}-${d}-${y.slice(-2)}`;
}

/** Format ISO date as "Jun 4" for compact labels. */
export function formatShortMonthDay(isoDate: string | null | undefined): string {
  if (isoDate == null || isoDate === "") return "None";
  const datePart = isoDate.trim().slice(0, 10);
  const d = new Date(`${datePart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "None";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Format ISO date as "May 30, 2026" for detail rows. */
export function formatLongDate(isoDate: string | null | undefined): string | null {
  if (isoDate == null || isoDate === "") return null;
  const datePart = isoDate.trim().slice(0, 10);
  const d = new Date(`${datePart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Format ISO date as "Aug 2029" for goal completion copy. */
export function formatMonthYear(isoDate: string | null | undefined): string | null {
  if (isoDate == null || isoDate === "") return null;
  const datePart = isoDate.trim().slice(0, 10);
  const d = new Date(`${datePart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function formatHealthRiskDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  return formatDateDisplay(isoDate);
}

/** Format ISO datetime for display — date portion only as MM-DD-YY. */
export function formatDateTimeDisplay(isoDateTime: string | null | undefined): string {
  if (isoDateTime == null || isoDateTime === "") return "—";
  return formatDateDisplay(isoDateTime);
}

export function parseIsoDateParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw?.trim()) return null;
  const datePart = raw.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return datePart;
}

/** Parse ISO date to visible calendar month (0-indexed month). */
export function calendarMonthFromIsoDate(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split("-").map(Number);
  return { year: y, month: m - 1 };
}
