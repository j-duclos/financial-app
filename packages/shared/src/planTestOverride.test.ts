import { describe, expect, it } from "vitest";
import type { BillingStatus } from "./types";
import {
  canShowPlanTestControls,
  choiceToTestPlanOverride,
  effectivePlanLabel,
  simulatedPlanChoice,
  simulatedPlanChoiceLabel,
  testPlanIndicatorLabel,
} from "./planTestOverride";

const freeBilling: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
};

const overrideAvailable: BillingStatus = {
  ...freeBilling,
  test_override_available: true,
  test_plan_override: null,
  effective_plan: "FREE",
};

describe("plan test override helpers", () => {
  it("hides developer controls unless the backend reports capability and this is a dev build", () => {
    expect(canShowPlanTestControls(overrideAvailable, false)).toBe(false);
    expect(canShowPlanTestControls(freeBilling, true)).toBe(false);
    expect(canShowPlanTestControls(undefined, true)).toBe(false);
    expect(canShowPlanTestControls(overrideAvailable, true)).toBe(true);
  });

  it("never shows an indicator in production builds even if the payload is misconfigured", () => {
    const spoofed: BillingStatus = {
      ...freeBilling,
      test_override_available: true,
      test_plan_override: "PREMIUM",
      effective_plan: "PREMIUM",
    };
    expect(testPlanIndicatorLabel(spoofed, false)).toBeNull();
    expect(canShowPlanTestControls(spoofed, false)).toBe(false);
  });

  it("shows TEST: Premium / TEST: Free only when an override is active", () => {
    expect(testPlanIndicatorLabel(overrideAvailable, true)).toBeNull();
    expect(
      testPlanIndicatorLabel({ ...overrideAvailable, test_plan_override: "PREMIUM" }, true)
    ).toBe("TEST: Premium");
    expect(
      testPlanIndicatorLabel({ ...overrideAvailable, test_plan_override: "FREE" }, true)
    ).toBe("TEST: Free");
  });

  it("maps simulated plan choices for the settings control", () => {
    expect(simulatedPlanChoice(overrideAvailable)).toBe("real");
    expect(simulatedPlanChoice({ ...overrideAvailable, test_plan_override: "PREMIUM" })).toBe(
      "PREMIUM"
    );
    expect(simulatedPlanChoiceLabel("real")).toBe("Real billing");
    expect(simulatedPlanChoiceLabel("FREE")).toBe("Free");
    expect(simulatedPlanChoiceLabel("PREMIUM")).toBe("Premium");
    expect(choiceToTestPlanOverride("real")).toBeNull();
    expect(choiceToTestPlanOverride("PREMIUM")).toBe("PREMIUM");
  });

  it("prefers effective_plan when present", () => {
    expect(effectivePlanLabel({ ...freeBilling, is_premium: false, effective_plan: "PREMIUM" })).toBe(
      "PREMIUM"
    );
    expect(effectivePlanLabel(freeBilling)).toBe("FREE");
  });
});
