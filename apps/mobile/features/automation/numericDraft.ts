/** Keep numeric TextFields editable: empty and partial values are allowed while typing. */

export function draftDigits(value: string, maxLen: number): string {
  return value.replace(/\D/g, "").slice(0, maxLen);
}

export function parseBoundedInt(value: string, min: number, max: number): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}
