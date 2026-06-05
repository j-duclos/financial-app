import { describe, expect, it } from "vitest";
import {
  dayHeatAriaLabel,
  dayHeatEmoji,
  dayHeatLabel,
  dayHeatReason,
  dayHeatShowsReason,
  resolveDayHeatLevel,
} from "./dayHeatDisplay";

describe("dayHeatDisplay", () => {
  it("resolves healthy from heat_level", () => {
    expect(resolveDayHeatLevel({ heat_level: "healthy" })).toBe("healthy");
    expect(dayHeatEmoji("healthy")).toBe("🟢");
    expect(dayHeatLabel("healthy")).toBe("Healthy");
    expect(dayHeatLabel("dangerous")).toBe("Critical");
    expect(dayHeatLabel("tight")).toBe("At Risk");
  });

  it("resolves tight and dangerous", () => {
    expect(resolveDayHeatLevel({ heat_level: "tight" })).toBe("tight");
    expect(dayHeatEmoji("tight")).toBe("🟠");
    expect(resolveDayHeatLevel({ heat_level: "dangerous" })).toBe("dangerous");
    expect(dayHeatEmoji("dangerous")).toBe("🔴");
  });

  it("falls back to risk_level when heat_level missing", () => {
    expect(resolveDayHeatLevel({ risk_level: "critical", has_risk: true })).toBe("dangerous");
    expect(resolveDayHeatLevel({ risk_level: "watch", has_risk: true })).toBe("tight");
    expect(resolveDayHeatLevel({ risk_level: "none", has_risk: false })).toBe("neutral");
  });

  it("shows heat reason for tight and dangerous", () => {
    expect(
      dayHeatReason({
        heat_reason: "Below buffer: Main $86.00",
        heat_level: "tight",
      })
    ).toContain("Below buffer");
    expect(dayHeatShowsReason("tight")).toBe(true);
    expect(dayHeatShowsReason("healthy")).toBe(false);
  });

  it("normalizes legacy projected-negative heat reason when balance is known", () => {
    expect(
      dayHeatReason({
        heat_reason: "Worst: Main projected negative",
        affected_account_name: "Main",
        lowest_projected_balance: "-19.62",
        is_negative: true,
      })
    ).toBe("Main projected -$19.62");
  });

  it("builds accessible aria label", () => {
    const label = dayHeatAriaLabel(
      {
        heat_level: "dangerous",
        heat_label: "Dangerous",
        heat_reason: "Main projected -$19.62",
      },
      "Jun 17"
    );
    expect(label).toContain("Dangerous");
    expect(label).toContain("Main projected -$19.62");
  });
});
