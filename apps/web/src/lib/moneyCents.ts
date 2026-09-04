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

export function isCreditAccountType(accountType: string | null | undefined): boolean {
  return String(accountType ?? "").toUpperCase() === "CREDIT";
}

/**
 * Statement ending balance in signed cents.
 * Credit debt is negative or zero — a typed positive amount is treated as owed (no minus required).
 * Already-negative input is left as-is. Matches backend `_normalize_credit_balance`.
 */
export function parseSignedBankBalanceCents(
  input: string,
  accountType?: string | null
): number | null {
  const cents = parseBankBalanceCents(input);
  if (cents == null) return null;
  if (isCreditAccountType(accountType) && cents > 0) return -cents;
  return cents;
}

/** Exact two-decimal string for reconcile API payloads. */
export function bankBalanceAmountString(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
