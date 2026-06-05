/** Format ISO YYYY-MM-DD (or datetime prefix) for display as MM-DD-YY. */
export function formatDateDisplay(isoDate: string | null | undefined): string {
  if (isoDate == null || isoDate === "") return "—";
  const datePart = isoDate.trim().slice(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return isoDate;
  return `${m}-${d}-${y.slice(-2)}`;
}

/** Format ISO datetime for display — date portion only as MM-DD-YY. */
export function formatDateTimeDisplay(isoDateTime: string | null | undefined): string {
  if (isoDateTime == null || isoDateTime === "") return "—";
  return formatDateDisplay(isoDateTime);
}

/** Format ISO date as "Jun 4" for decision summaries; returns "None" when empty. */
export function formatShortMonthDay(isoDate: string | null | undefined): string {
  if (isoDate == null || isoDate === "") return "None";
  const datePart = isoDate.trim().slice(0, 10);
  const d = new Date(`${datePart}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "None";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
