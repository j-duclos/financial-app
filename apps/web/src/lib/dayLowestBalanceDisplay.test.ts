import { describe, expect, it } from "vitest";
import {
  formatDashboardLowestMarker,
  formatTimelineLowestMarker,
  inlineProjectedBalanceWarnings,
  lowestMarkerAriaLabel,
  shouldShowLowestBalanceMarker,
} from "./dayLowestBalanceDisplay";

describe("dayLowestBalanceDisplay", () => {
  const dangerousDay = {
    heat_level: "dangerous" as const,
    show_lowest_balance_marker: true,
    lowest_projected_balance: "-1043.00",
    lowest_projected_balance_account_name: "Main",
    is_negative: true,
  };

  const tightDay = {
    heat_level: "tight" as const,
    show_lowest_balance_marker: true,
    lowest_projected_balance: "42.00",
    lowest_projected_balance_account_name: "Main",
    below_buffer_amount: "158.00",
  };

  const healthyDay = {
    heat_level: "healthy" as const,
    show_lowest_balance_marker: false,
    lowest_projected_balance: "900.00",
    lowest_projected_balance_account_name: "Main",
  };

  it("shows timeline marker on dangerous day", () => {
    expect(shouldShowLowestBalanceMarker(dangerousDay)).toBe(true);
    const text = formatTimelineLowestMarker(dangerousDay);
    expect(text).toBe("Main projected -$1,043.00");
  });

  it("shows below-buffer wording on tight day", () => {
    expect(shouldShowLowestBalanceMarker(tightDay)).toBe(true);
    const text = formatTimelineLowestMarker(tightDay);
    expect(text).toContain("Main");
  });

  it("hides marker on healthy day", () => {
    expect(shouldShowLowestBalanceMarker(healthyDay)).toBe(false);
    expect(formatTimelineLowestMarker(healthyDay)).toBeNull();
  });

  it("formats compact dashboard marker for negative balance", () => {
    const text = formatDashboardLowestMarker(dangerousDay);
    expect(text).toBe("Main projected -$1,043.00");
  });

  it("single-account view omits account name", () => {
    const text = formatTimelineLowestMarker(dangerousDay, { singleAccountView: true });
    expect(text).toBe("Projected -$1,043.00");
  });

  it("includes accessible warning label", () => {
    const aria = lowestMarkerAriaLabel(dangerousDay);
    expect(aria).toBe("Main projected -$1,043.00");
  });

  it("shows marker when API omits show flag but day is still negative", () => {
    expect(
      shouldShowLowestBalanceMarker({
        heat_level: "dangerous",
        show_lowest_balance_marker: false,
        lowest_projected_balance: "-562.88",
        lowest_projected_balance_account_name: "Main",
        is_negative: true,
      })
    ).toBe(true);
  });

  it("consolidates duplicate Main negative warnings into one line", () => {
    const warnings = inlineProjectedBalanceWarnings({
      heat_level: "dangerous",
      heat_reason: "Main projected negative",
      affected_account_name: "Main",
      is_negative: true,
      show_lowest_balance_marker: true,
      lowest_projected_balance: "-479.41",
      lowest_projected_balance_account_name: "Main",
    });
    expect(warnings).toEqual(["Main projected -$479.41"]);
  });

  it("shows credit utilization warnings from API", () => {
    const warnings = inlineProjectedBalanceWarnings({
      heat_level: "dangerous",
      is_negative: true,
      show_lowest_balance_marker: true,
      lowest_projected_balance: "-514.41",
      lowest_projected_balance_account_name: "Main",
      credit_balance_warnings: [
        { account_name: "Venture", message: "Venture 80% utilized", severity: "dangerous" },
      ],
    });
    expect(warnings).toEqual(["Venture 80% utilized", "Main projected -$514.41"]);
  });

  it("shows separate warnings for different negative accounts", () => {
    const warnings = inlineProjectedBalanceWarnings({
      heat_level: "dangerous",
      heat_reason: "Savor projected -$200.00",
      affected_account_name: "Savor",
      is_negative: true,
      show_lowest_balance_marker: true,
      lowest_projected_balance: "-19.62",
      lowest_projected_balance_account_name: "Main",
    });
    expect(warnings).toEqual(["Savor projected -$200.00", "Main projected -$19.62"]);
  });

  it("uses compact negative wording even when after-description is present", () => {
    const text = formatTimelineLowestMarker({
      ...dangerousDay,
      lowest_projected_balance_after_description: "Rent",
    });
    expect(text).toBe("Main projected -$1,043.00");
  });
});
