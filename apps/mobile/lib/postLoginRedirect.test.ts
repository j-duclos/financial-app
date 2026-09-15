import { beforeEach, describe, expect, it } from "vitest";
import {
  beginLogoutSession,
  consumePendingPostLoginRedirect,
  POST_LOGIN_HOME_ROUTE,
  resetPostLoginRedirectForTests,
  sanitizePostLoginRedirect,
  setPendingPostLoginRedirect,
} from "./postLoginRedirect";

describe("postLoginRedirect", () => {
  beforeEach(() => {
    resetPostLoginRedirectForTests();
  });

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

  it("does not restore the last screen after logout", () => {
    setPendingPostLoginRedirect("/profile");
    beginLogoutSession();
    setPendingPostLoginRedirect("/profile");
    setPendingPostLoginRedirect("/profile");
    expect(consumePendingPostLoginRedirect()).toBeNull();
    expect(POST_LOGIN_HOME_ROUTE).toBe("/(app)/(tabs)/index");
  });
});
