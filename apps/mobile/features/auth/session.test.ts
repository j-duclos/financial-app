import { describe, expect, it } from "vitest";
import { hasCompleteSession, resolveSessionRestore } from "./session";

describe("auth session restore", () => {
  it("requires both access and refresh tokens", () => {
    expect(hasCompleteSession({ access: "a", refresh: null })).toBe(false);
    expect(hasCompleteSession({ access: "a", refresh: "r" })).toBe(true);
  });

  it("marks missing tokens as unauthenticated", () => {
    expect(resolveSessionRestore({ access: null, refresh: null }, false)).toEqual({
      status: "unauthenticated",
    });
  });

  it("marks failed profile probe as expired", () => {
    expect(resolveSessionRestore({ access: "a", refresh: "r" }, false)).toEqual({
      status: "expired",
    });
  });

  it("authenticates when profile probe succeeds", () => {
    expect(resolveSessionRestore({ access: "a", refresh: "r" }, true)).toEqual({
      status: "authenticated",
      access: "a",
      refresh: "r",
    });
  });
});
