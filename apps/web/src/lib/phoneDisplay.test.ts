import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, formatPhoneInput } from "./phoneDisplay";

describe("formatPhoneForDisplay", () => {
  it("formats US E.164 as a national number", () => {
    expect(formatPhoneForDisplay("+15204615387")).toBe("(520) 461-5387");
    expect(formatPhoneForDisplay("5204615387")).toBe("(520) 461-5387");
  });

  it("leaves blank and non-US values usable", () => {
    expect(formatPhoneForDisplay("")).toBe("");
    expect(formatPhoneForDisplay(null)).toBe("");
    expect(formatPhoneForDisplay("+442071838750")).toBe("+442071838750");
  });
});

describe("formatPhoneInput", () => {
  it("formats US digits as the user types", () => {
    expect(formatPhoneInput("520")).toBe("(520");
    expect(formatPhoneInput("520461")).toBe("(520) 461");
    expect(formatPhoneInput("5204615387")).toBe("(520) 461-5387");
    expect(formatPhoneInput("+15204615387")).toBe("(520) 461-5387");
  });

  it("does not rewrite non-US international input", () => {
    expect(formatPhoneInput("+442071838750")).toBe("+442071838750");
  });
});
