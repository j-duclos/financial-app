import { describe, expect, it } from "vitest";
import { draftDigits, parseBoundedInt } from "./numericDraft";

describe("numericDraft", () => {
  it("lets the user clear a day-of-month field instead of snapping back to 1", () => {
    expect(draftDigits("", 2)).toBe("");
    expect(draftDigits("1", 2)).toBe("1");
    expect(draftDigits("25", 2)).toBe("25");
    expect(draftDigits("2a5", 2)).toBe("25");
    expect(draftDigits("251", 2)).toBe("25");
  });

  it("parses 1–31 only when the draft is a complete valid day", () => {
    expect(parseBoundedInt("", 1, 31)).toBeNull();
    expect(parseBoundedInt("1", 1, 31)).toBe(1);
    expect(parseBoundedInt("25", 1, 31)).toBe(25);
    expect(parseBoundedInt("0", 1, 31)).toBeNull();
    expect(parseBoundedInt("32", 1, 31)).toBeNull();
  });
});
