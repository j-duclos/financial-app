import { describe, expect, it } from "vitest";
import { formatDateDisplay, formatDateTimeDisplay } from "./dateDisplay";

describe("formatDateDisplay", () => {
  it("formats ISO date as MM-DD-YY", () => {
    expect(formatDateDisplay("2026-05-23")).toBe("05-23-26");
    expect(formatDateDisplay("2026-06-17")).toBe("06-17-26");
  });

  it("returns em dash for empty values", () => {
    expect(formatDateDisplay(null)).toBe("—");
    expect(formatDateDisplay("")).toBe("—");
  });
});

describe("formatDateTimeDisplay", () => {
  it("uses date portion only", () => {
    expect(formatDateTimeDisplay("2026-05-28T14:30:00Z")).toBe("05-28-26");
  });
});
