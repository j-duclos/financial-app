/**
 * Integer-cent money helpers.
 *
 * Matches Django `Decimal.quantize(Decimal("0.01"))` (ROUND_HALF_EVEN).
 * Engine math must not use IEEE floats.
 */

export type Cents = bigint;

const CENTS_PER_DOLLAR = 100n;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Convert a decimal dollar string (or finite number) to integer cents.
 * Does not flip signs. `" -10.50 "` → `-1050`.
 */
export function dollarsToCents(value: string | number): Cents {
  const raw = typeof value === "number" ? numberToDecimalText(value) : String(value).trim();
  if (raw === "" || raw === "+" || raw === "-" || raw === ".") {
    throw new Error(`Invalid money value: ${JSON.stringify(value)}`);
  }
  const negative = raw.startsWith("-");
  const unsigned = raw.startsWith("+") || negative ? raw.slice(1) : raw;
  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    throw new Error(`Invalid money value: ${JSON.stringify(value)}`);
  }
  const [wholePart, fracRaw = ""] = unsigned.split(".");
  const cents = quantizeFractionToCents(wholePart, fracRaw);
  return negative ? -cents : cents;
}

function numberToDecimalText(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid money value: ${value}`);
  }
  return value.toFixed(16).replace(/\.?0+$/, "") || "0";
}

/** ROUND_HALF_EVEN to two decimal places, then scale to cents. */
function quantizeFractionToCents(wholePart: string, fracRaw: string): Cents {
  const whole = BigInt(wholePart === "" ? "0" : wholePart);
  const frac = fracRaw.replace(/0+$/, "");
  if (frac.length <= 2) {
    const hundredths = BigInt((frac + "00").slice(0, 2));
    return whole * CENTS_PER_DOLLAR + hundredths;
  }

  const hundredthsDigit = Number(frac[1] ?? "0");
  const remainderDigit = Number(frac[2] ?? "0");
  const remainderTail = frac.slice(3);
  const exactHalf = remainderDigit === 5 && (remainderTail === "" || /^0+$/.test(remainderTail));
  let roundedHundredths = Number(frac.slice(0, 2));

  let roundUp = false;
  if (remainderDigit > 5 || (remainderDigit === 5 && !exactHalf)) {
    roundUp = true;
  } else if (exactHalf && hundredthsDigit % 2 === 1) {
    roundUp = true;
  }

  if (roundUp) roundedHundredths += 1;
  if (roundedHundredths >= 100) {
    return (whole + 1n) * CENTS_PER_DOLLAR;
  }
  return whole * CENTS_PER_DOLLAR + BigInt(roundedHundredths);
}

/** Format cents as a 2-decimal dollar string. `-50` → `"-0.50"`. */
export function centsToDollars(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / CENTS_PER_DOLLAR;
  const frac = abs % CENTS_PER_DOLLAR;
  const body = `${whole.toString()}.${pad2(Number(frac))}`;
  return negative ? `-${body}` : body;
}

export function addCents(a: Cents, b: Cents): Cents {
  return a + b;
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return a - b;
}

/** Quantize an arbitrary decimal string to 2 places (half-even). */
export function quantizeDollars(value: string | number): string {
  return centsToDollars(dollarsToCents(value));
}
