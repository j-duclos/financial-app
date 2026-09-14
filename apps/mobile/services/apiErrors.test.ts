import { describe, expect, it } from "vitest";
import { ApiError, describeApiError, describeAuthFormError } from "./apiErrors";

describe("describeApiError", () => {
  it("maps common HTTP statuses to user-facing copy", () => {
    expect(describeApiError(new ApiError(401, "x"))).toMatch(/session expired/i);
    expect(describeApiError(new ApiError(403, "x"))).toMatch(/permission/i);
    expect(describeApiError(new ApiError(404, "x"))).toMatch(/not found/i);
    expect(describeApiError(new ApiError(500, "x"))).toMatch(/server/i);
    expect(describeApiError(new ApiError(422, "Bad field"))).toBe("Bad field");
    expect(describeApiError(new ApiError(429, "x"))).toMatch(/rate-limited/i);
    expect(describeApiError(new ApiError(504, "Gateway timeout"))).toMatch(/timeout/i);
    expect(
      describeApiError(
        new ApiError(503, "This web process is not using SMTP, so no inbox message was sent.")
      )
    ).toMatch(/smtp/i);
  });

  it("maps premium_required 403s to upgrade copy without treating every 403 as billing", () => {
    expect(
      describeApiError(
        new ApiError(403, "Custom payoff simulations are available with Premium.", {
          code: "premium_required",
          feature: "payment_planner_full",
          upgradeRequired: true,
        })
      )
    ).toMatch(/premium/i);
    expect(describeApiError(new ApiError(403, "x"))).toMatch(/permission/i);
    expect(describeApiError(new ApiError(401, "x"))).toMatch(/session expired/i);
  });

  it("maps JWT credential 401s to a login failure, not session expiry", () => {
    expect(
      describeApiError(new ApiError(401, "No active account found with the given credentials"))
    ).toMatch(/incorrect username or password/i);
  });

  it("surfaces network failures clearly", () => {
    expect(describeApiError(new Error("Network request failed"))).toMatch(/network unavailable/i);
  });
});

describe("describeAuthFormError", () => {
  it("treats any login 401 as bad credentials", () => {
    expect(describeAuthFormError(new ApiError(401, "x"))).toMatch(/incorrect username or password/i);
    expect(
      describeAuthFormError(new ApiError(401, "No active account found with the given credentials"))
    ).toMatch(/incorrect username or password/i);
  });

  it("falls through to describeApiError for other failures", () => {
    expect(describeAuthFormError(new ApiError(500, "x"))).toMatch(/server/i);
    expect(describeAuthFormError(new Error("Network request failed"))).toMatch(/network unavailable/i);
  });
});
