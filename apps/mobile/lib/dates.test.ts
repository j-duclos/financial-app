import { describe, expect, it } from "vitest";
import {
  coerceToInputDate,
  formatDateInput,
  formatIsoDateForInput,
  parseInputDateToIso,
} from "./dates";

describe("transaction date input", () => {
  it("formats ISO to MM-DD-YYYY", () => {
    expect(formatIsoDateForInput("2026-08-24")).toBe("08-24-2026");
  });

  it("auto-formats digits as MM-DD-YYYY while typing", () => {
    expect(formatDateInput("08242026")).toBe("08-24-2026");
    expect(formatDateInput("08-24-2026")).toBe("08-24-2026");
  });

  it("parses MM-DD-YYYY to ISO for API", () => {
    expect(parseInputDateToIso("08-24-2026")).toBe("2026-08-24");
    expect(parseInputDateToIso("08-24-26")).toBeNull();
    expect(parseInputDateToIso("13-01-2026")).toBeNull();
  });

  it("coerces route ISO values to input format", () => {
    expect(coerceToInputDate("2026-08-24")).toBe("08-24-2026");
    expect(coerceToInputDate("08-24-2026")).toBe("08-24-2026");
  });
});
