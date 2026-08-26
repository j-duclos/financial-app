import { describe, expect, it } from "vitest";
import { ApiError, describeApiError } from "./apiErrors";

describe("describeApiError", () => {
  it("maps common HTTP statuses to user-facing copy", () => {
    expect(describeApiError(new ApiError(401, "x"))).toMatch(/session expired/i);
    expect(describeApiError(new ApiError(403, "x"))).toMatch(/permission/i);
    expect(describeApiError(new ApiError(404, "x"))).toMatch(/not found/i);
    expect(describeApiError(new ApiError(500, "x"))).toMatch(/server/i);
    expect(describeApiError(new ApiError(422, "Bad field"))).toBe("Bad field");
  });

  it("surfaces network failures clearly", () => {
    expect(describeApiError(new Error("Network request failed"))).toMatch(/network unavailable/i);
  });
});
