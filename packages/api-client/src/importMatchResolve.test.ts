import { describe, expect, it } from "vitest";
import { ApiError } from "./config";
import { isImportMatcherRejection } from "./api";

describe("isImportMatcherRejection", () => {
  it("treats the production no-candidate error as user-confirmed", () => {
    expect(
      isImportMatcherRejection(
        new ApiError(400, "No matching imported bank transaction was found for this scheduled item.")
      )
    ).toBe(true);
    expect(isImportMatcherRejection(new ApiError(400, "No matching imports"))).toBe(true);
    expect(isImportMatcherRejection(new ApiError(409, "Multiple imported bank transactions"))).toBe(
      true
    );
  });

  it("does not swallow unrelated failures", () => {
    expect(isImportMatcherRejection(new ApiError(400, "Reconciled transactions cannot be matched."))).toBe(
      false
    );
    expect(isImportMatcherRejection(new ApiError(500, "Server error"))).toBe(false);
  });
});
