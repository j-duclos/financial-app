/** Unsigned money typing helpers. Sign comes from transaction type, never from the field. */

export function sanitizeUnsignedMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  const whole = cleaned.slice(0, firstDot);
  const frac = cleaned
    .slice(firstDot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return `${whole}.${frac}`;
}

export function parseUnsignedMoney(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function validatePositiveMoney(raw: string, label = "Amount"): string | undefined {
  const n = parseUnsignedMoney(raw);
  if (n == null) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "$") return `${label} is required.`;
    return `Enter a valid ${label.toLowerCase()}.`;
  }
  if (n <= 0) return `${label} must be greater than 0.`;
  return undefined;
}

export function formatMoneyFieldDisplay(unsigned: string): string {
  if (!unsigned) return "";
  return `$ ${unsigned}`;
}

export function signedCanonicalAmount(
  entryType: "expense" | "income" | "transfer",
  unsigned: string
): string {
  const n = parseUnsignedMoney(unsigned);
  if (n == null) return unsigned;
  const formatted = n.toFixed(2);
  if (entryType === "income" || entryType === "transfer") return formatted;
  return `-${formatted}`;
}
