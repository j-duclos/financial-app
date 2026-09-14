import { describe, expect, it } from "vitest";
import { ApiError } from "./config";
import {
  classifyApiAccessError,
  isAuthFailureError,
  isPlanLimitReachedError,
  isPremiumRequiredError,
} from "./entitlementErrors";

describe("premium_required recognition", () => {
  it("recognizes a 403 with code premium_required", () => {
    const error = new ApiError(403, "Custom payoff simulations are available with Premium.", {
      code: "premium_required",
      feature: "payment_planner_full",
      upgradeRequired: true,
    });
    expect(isPremiumRequiredError(error)).toBe(true);
    expect(isPlanLimitReachedError(error)).toBe(false);
    expect(isAuthFailureError(error)).toBe(false);
    expect(classifyApiAccessError(error)).toBe("premium_required");
    expect(error.feature).toBe("payment_planner_full");
  });

  it("does not treat ordinary 403s as billing errors", () => {
    const forbidden = new ApiError(403, "You do not have permission to do that.");
    expect(isPremiumRequiredError(forbidden)).toBe(false);
    expect(isPlanLimitReachedError(forbidden)).toBe(false);
    expect(classifyApiAccessError(forbidden)).toBe("other");
  });

  it("does not treat email-verification 403 as premium_required", () => {
    const verify = new ApiError(403, "Verify your email before subscribing.", {
      code: "email_verification_required",
    });
    expect(isPremiumRequiredError(verify)).toBe(false);
    expect(classifyApiAccessError(verify)).toBe("other");
  });

  it("keeps 401 auth failures distinct", () => {
    const auth = new ApiError(401, "Authentication credentials were not provided.");
    expect(isPremiumRequiredError(auth)).toBe(false);
    expect(isAuthFailureError(auth)).toBe(true);
    expect(classifyApiAccessError(auth)).toBe("auth");
  });

  it("keeps plan_limit_reached distinct from premium_required", () => {
    const limit = new ApiError(403, "The Free plan includes up to 3 accounts.", {
      code: "plan_limit_reached",
      feature: "manual_accounts",
      upgradeRequired: true,
      limit: 3,
    });
    expect(isPremiumRequiredError(limit)).toBe(false);
    expect(isPlanLimitReachedError(limit)).toBe(true);
    expect(classifyApiAccessError(limit)).toBe("plan_limit_reached");
  });

  it("does not classify non-ApiError values", () => {
    expect(isPremiumRequiredError(new Error("403 premium_required"))).toBe(false);
    expect(isPremiumRequiredError({ code: "premium_required", status: 403 })).toBe(false);
    expect(classifyApiAccessError("premium_required")).toBe("other");
  });
});
