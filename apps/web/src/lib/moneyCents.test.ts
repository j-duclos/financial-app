import { describe, expect, it } from "vitest";
import { centsToAmount, parseBankBalanceCents, parseMoneyToCents } from "./moneyCents";

describe("moneyCents", () => {
  it("adds 0.10 and 0.20 as cents without float drift", () => {
    expect(parseMoneyToCents("0.10") + parseMoneyToCents("0.20")).toBe(30);
    expect(centsToAmount(30)).toBe(0.3);
  });

  it("parses two-decimal currency strings exactly", () => {
    expect(parseMoneyToCents("1239.94")).toBe(123994);
    expect(parseMoneyToCents("-70.99")).toBe(-7099);
    expect(parseMoneyToCents("2,316.63")).toBe(231663);
  });

  it("treats empty or invalid input as zero", () => {
    expect(parseMoneyToCents("")).toBe(0);
    expect(parseMoneyToCents("abc")).toBe(0);
    expect(parseMoneyToCents(null)).toBe(0);
  });

  it("treats blank or invalid bank balance as not entered", () => {
    expect(parseBankBalanceCents("")).toBeNull();
    expect(parseBankBalanceCents("abc")).toBeNull();
    expect(parseBankBalanceCents("2316.63")).toBe(231663);
    expect(parseBankBalanceCents("0")).toBe(0);
  });
});
