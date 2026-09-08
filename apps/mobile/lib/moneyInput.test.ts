import { describe, expect, it } from "vitest";
import {
  formatMoneyFieldDisplay,
  parseUnsignedMoney,
  sanitizeUnsignedMoneyInput,
  signedCanonicalAmount,
  validatePositiveMoney,
} from "./moneyInput";

describe("unsigned money input", () => {
  it("accepts 47.82 and formats with a dollar prefix", () => {
    expect(sanitizeUnsignedMoneyInput("47.82")).toBe("47.82");
    expect(parseUnsignedMoney("47.82")).toBe(47.82);
    expect(formatMoneyFieldDisplay("47.82")).toBe("$ 47.82");
    expect(validatePositiveMoney("47.82")).toBeUndefined();
  });

  it("rejects alphabetic amount text such as Gasoline", () => {
    expect(sanitizeUnsignedMoneyInput("Gasoline")).toBe("");
    expect(parseUnsignedMoney("Gasoline")).toBeNull();
    expect(validatePositiveMoney("Gasoline")).toMatch(/valid/i);
  });

  it("rejects zero", () => {
    expect(validatePositiveMoney("0")).toMatch(/greater than 0/);
    expect(validatePositiveMoney("0.00")).toMatch(/greater than 0/);
  });

  it("rejects a manually typed negative value", () => {
    expect(parseUnsignedMoney("-47.82")).toBeNull();
    expect(validatePositiveMoney("-47.82")).toMatch(/valid/i);
    expect(sanitizeUnsignedMoneyInput("-47.82")).toBe("47.82");
  });

  it("keeps cents and strips extra fraction digits", () => {
    expect(sanitizeUnsignedMoneyInput("12.349")).toBe("12.34");
  });
});

describe("canonical signed amounts", () => {
  it("expenses are stored negative and income positive", () => {
    expect(signedCanonicalAmount("expense", "47.82")).toBe("-47.82");
    expect(signedCanonicalAmount("income", "47.82")).toBe("47.82");
    expect(signedCanonicalAmount("transfer", "47.82")).toBe("47.82");
  });
});
