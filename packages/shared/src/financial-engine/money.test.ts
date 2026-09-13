import { describe, expect, it } from "vitest";
import { centsToDollars, dollarsToCents, addCents, quantizeDollars, subtractCents } from "./money";

describe("financial-engine money", () => {
  it("converts dollars to integer cents without flipping sign", () => {
    expect(dollarsToCents("1000.00")).toBe(100000n);
    expect(dollarsToCents("-45.67")).toBe(-4567n);
    expect(dollarsToCents("0.00")).toBe(0n);
    expect(dollarsToCents(" 10.50 ")).toBe(1050n);
  });

  it("formats cents with two decimal places", () => {
    expect(centsToDollars(100000n)).toBe("1000.00");
    expect(centsToDollars(-50n)).toBe("-0.50");
    expect(centsToDollars(0n)).toBe("0.00");
  });

  it("adds and subtracts in cents so 0.10 + 0.20 is 0.30", () => {
    const sum = addCents(dollarsToCents("0.10"), dollarsToCents("0.20"));
    expect(centsToDollars(sum)).toBe("0.30");
    expect(centsToDollars(subtractCents(dollarsToCents("10.10"), dollarsToCents("0.15")))).toBe("9.95");
  });

  it("quantizes with banker's rounding like Django Decimal.quantize(0.01)", () => {
    expect(quantizeDollars("1.005")).toBe("1.00");
    expect(quantizeDollars("1.015")).toBe("1.02");
    expect(quantizeDollars("1.025")).toBe("1.02");
    expect(quantizeDollars("1.035")).toBe("1.04");
    expect(quantizeDollars("0.995")).toBe("1.00");
    expect(quantizeDollars("10.555")).toBe("10.56");
  });
});
