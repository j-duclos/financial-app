/** Display/edit helpers for profile phone numbers. Server still stores E.164. */

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Format a stored E.164 (or loose input) for a US-friendly field. */
export function formatPhoneForDisplay(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const digits = digitsOnly(raw);
  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return raw;
}

/**
 * Light as-you-type formatting for US numbers.
 * International values that start with + (other than +1) are left alone.
 */
export function formatPhoneInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) {
    return value;
  }
  const digits = digitsOnly(value);
  const national =
    digits.length >= 11 && digits.startsWith("1") ? digits.slice(1, 11) : digits.slice(0, 10);
  if (national.length === 0) return trimmed.startsWith("+") ? "+" : "";
  if (national.length < 4) return `(${national}`;
  if (national.length < 7) return `(${national.slice(0, 3)}) ${national.slice(3)}`;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
