/** Today's date in YYYY-MM-DD using local timezone (not UTC). */
export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysToIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function addMonthsToIsoDate(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setMonth(dt.getMonth() + months);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function maxIsoDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export function formatDateDisplay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatLongDate(iso: string | null | undefined): string | null {
  if (iso == null || iso === "") return null;
  const datePart = iso.trim().slice(0, 10);
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Today's date as MM-DD-YYYY for mobile form inputs. */
export function todayInputDate(): string {
  return formatIsoDateForInput(todayStr());
}

/** ISO YYYY-MM-DD → MM-DD-YYYY for editable date fields. */
export function formatIsoDateForInput(iso: string): string {
  const datePart = iso.trim().slice(0, 10);
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return iso;
  return `${match[2]}-${match[3]}-${match[1]}`;
}

/** Normalize route/API values (ISO or MM-DD-YYYY) to MM-DD-YYYY for the form. */
export function coerceToInputDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed.slice(0, 10))) {
    return formatIsoDateForInput(trimmed);
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return trimmed;
  return trimmed;
}

/** Keep digits only and insert dashes: MM-DD-YYYY (max 10 chars). */
export function formatDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}

/** Parse MM-DD-YYYY to ISO YYYY-MM-DD for API payloads; null when incomplete/invalid. */
export function parseInputDateToIso(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const dt = new Date(year, month - 1, day);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
