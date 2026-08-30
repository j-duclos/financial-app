import { describe, expect, it } from "vitest";
import { calendarSafeUntilPresentation } from "./calendarSafeUntilDisplay";
import type { CalendarSafeUntil } from "./types";

const formatMoney = (amount: string) => `$${amount}`;

describe("calendarSafeUntilPresentation", () => {
  it("renders available safe-until copy from backend amounts", () => {
    const safeUntil: CalendarSafeUntil = {
      status: "available",
      reason: null,
      next_income_date: "2026-09-15",
      safe_amount: "1200.00",
      unsafe_date: null,
      obligations_before_income: "400.00",
      current_balance: "1600.00",
    };
    const view = calendarSafeUntilPresentation(safeUntil, formatMoney);
    expect(view.primaryText).toContain("Safe until");
    expect(view.primaryText).toContain("$1200.00");
    expect(view.tone).toBe("positive");
  });

  it("renders no upcoming income from explicit backend status", () => {
    const safeUntil: CalendarSafeUntil = {
      status: "no_upcoming_income",
      reason: "no_projected_income_in_horizon",
      next_income_date: null,
      safe_amount: "500.00",
      unsafe_date: null,
      obligations_before_income: "100.00",
      current_balance: "600.00",
    };
    const view = calendarSafeUntilPresentation(safeUntil, formatMoney);
    expect(view.primaryText).toBe("No projected income in horizon");
    expect(view.tone).toBe("neutral");
  });

  it("renders unavailable from explicit backend status", () => {
    const safeUntil: CalendarSafeUntil = {
      status: "unavailable",
      reason: "no_calendar_days",
      next_income_date: null,
      safe_amount: null,
      unsafe_date: null,
      obligations_before_income: null,
      current_balance: null,
    };
    const view = calendarSafeUntilPresentation(safeUntil, formatMoney);
    expect(view.primaryText).toBe("Unavailable");
    expect(view.tone).toBe("muted");
    expect(view.subtitle).toBe("no_calendar_days");
  });
});
