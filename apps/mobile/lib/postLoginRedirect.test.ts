import { describe, expect, it } from "vitest";
import {
  consumePendingPostLoginRedirect,
  sanitizePostLoginRedirect,
  setPendingPostLoginRedirect,
} from "./postLoginRedirect";

describe("postLoginRedirect", () => {
  it("allows safe in-app paths", () => {
    expect(sanitizePostLoginRedirect("/transaction/42")).toBe("/transaction/42");
    expect(sanitizePostLoginRedirect("/(app)/(tabs)")).toBe("/(app)/(tabs)");
    expect(sanitizePostLoginRedirect("/accounts")).toBe("/accounts");
    expect(sanitizePostLoginRedirect("/budget")).toBe("/budget");
    expect(sanitizePostLoginRedirect("/spending-limits")).toBe("/spending-limits");
    expect(sanitizePostLoginRedirect("/(app)/(tabs)/accounts")).toBe("/(app)/(tabs)/accounts");
  });

  it("rejects external and traversal paths", () => {
    expect(sanitizePostLoginRedirect("https://evil.com")).toBeNull();
    expect(sanitizePostLoginRedirect("/../secret")).toBeNull();
    expect(sanitizePostLoginRedirect("/admin")).toBeNull();
  });

  it("stores and consumes pending redirect once", () => {
    setPendingPostLoginRedirect("/account/7");
    expect(consumePendingPostLoginRedirect()).toBe("/account/7");
    expect(consumePendingPostLoginRedirect()).toBeNull();
  });
});
