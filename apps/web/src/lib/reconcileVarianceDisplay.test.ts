import { describe, expect, it } from "vitest";
import {
  reconcileVarianceDisplay,
  reconcileVarianceToneClass,
} from "./reconcileVarianceDisplay";

describe("reconcileVarianceDisplay", () => {
  it("returns balanced at zero within tolerance", () => {
    expect(reconcileVarianceDisplay(0)).toEqual({
      emoji: "🟢",
      label: "Balanced",
      amount: 0,
      tone: "balanced",
      severity: "warn",
    });
    expect(reconcileVarianceDisplay(0.005)?.tone).toBe("balanced");
  });

  it("returns over/under by for small gaps", () => {
    expect(reconcileVarianceDisplay(25.12)).toEqual({
      emoji: "🟡",
      label: "Over by",
      amount: 25.12,
      tone: "over_by",
      severity: "warn",
    });
    expect(reconcileVarianceDisplay(-25.12)).toEqual({
      emoji: "🟡",
      label: "Under by",
      amount: 25.12,
      tone: "under_by",
      severity: "warn",
    });
  });

  it("returns critical over/under by for large gaps", () => {
    expect(reconcileVarianceDisplay(680)).toEqual({
      emoji: "🔴",
      label: "Over by",
      amount: 680,
      tone: "over_by",
      severity: "critical",
    });
    expect(reconcileVarianceDisplay(53.73)?.label).toBe("Over by");
    expect(reconcileVarianceDisplay(-219.73)?.label).toBe("Under by");
    expect(reconcileVarianceDisplay(-219.73)?.severity).toBe("critical");
  });

  it("returns null when difference is unknown", () => {
    expect(reconcileVarianceDisplay(null)).toBeNull();
  });

  it("uses amber for over and red only for critical under", () => {
    expect(reconcileVarianceToneClass("balanced", "warn")).toBe("text-green-700");
    expect(reconcileVarianceToneClass("over_by", "warn")).toBe("text-amber-700");
    expect(reconcileVarianceToneClass("over_by", "critical")).toBe("text-amber-700");
    expect(reconcileVarianceToneClass("under_by", "warn")).toBe("text-amber-700");
    expect(reconcileVarianceToneClass("under_by", "critical")).toBe("text-red-700");
  });
});
