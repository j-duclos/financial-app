/** Integer cents for display-side money math (backend Decimal remains authoritative). */

export function parseMoneyToCents(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const raw =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value.toFixed(2)
        : ""
      : String(value).trim().replace(/,/g, "").replace(/^\+/, "");
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  if (!/^\d+(\.\d+)?$/.test(unsigned)) return 0;
  const [whole, frac = ""] = unsigned.split(".");
  const padded = `${frac}00`.slice(0, 2);
  const third = frac.length > 2 ? Number(frac[2]) : 0;
  let cents = Number(whole) * 100 + Number(padded);
  if (third >= 5) cents += 1;
  if (!Number.isFinite(cents)) return 0;
  return negative ? -cents : cents;
}

export function centsToAmount(cents: number): number {
  return cents / 100;
}

/** Bank-balance field: empty or non-numeric input is "not entered", not $0.00. */
export function parseBankBalanceCents(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, "").replace(/^\+/, "");
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return parseMoneyToCents(cleaned);
}
