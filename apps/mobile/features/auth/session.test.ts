import { describe, expect, it } from "vitest";
import { hasCompleteSession, resolveSessionRestore } from "./session";

describe("auth session restore", () => {
  it("requires both access and refresh tokens", () => {
    expect(hasCompleteSession({ access: "a", refresh: null })).toBe(false);
    expect(hasCompleteSession({ access: "a", refresh: "r" })).toBe(true);
  });

  it("marks missing tokens as unauthenticated", () => {
    expect(resolveSessionRestore({ access: null, refresh: null })).toEqual({
      status: "unauthenticated",
    });
  });

  it("authenticates immediately when both tokens are present", () => {
    expect(resolveSessionRestore({ access: "a", refresh: "r" })).toEqual({
      status: "authenticated",
      access: "a",
      refresh: "r",
    });
  });

  it("does not require a profile network probe before authenticated shell", () => {
    const decision = resolveSessionRestore({ access: "a", refresh: "r" });
    expect(decision.status).toBe("authenticated");
  });
});
