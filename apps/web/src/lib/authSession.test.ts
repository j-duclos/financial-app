import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WEB_ACCESS_KEY,
  WEB_REFRESH_KEY,
  clearWebAuthStorage,
  resolveProtectedAuthGate,
} from "./authSession";

describe("web auth session", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
        removeItem: (key: string) => {
          memory.delete(key);
        },
        clear: () => memory.clear(),
      },
    });
  });

  afterEach(() => {
    memory.clear();
  });

  it("treats recoverable loading separately from expired access", () => {
    expect(resolveProtectedAuthGate({ loading: true, access: "stale" })).toBe("loading");
    expect(resolveProtectedAuthGate({ loading: false, access: "ok" })).toBe("app");
    expect(resolveProtectedAuthGate({ loading: false, access: null })).toBe("login");
  });

  it("clears stored JWTs on logout without leaving a stale session", () => {
    localStorage.setItem(WEB_ACCESS_KEY, "access-jwt");
    localStorage.setItem(WEB_REFRESH_KEY, "refresh-jwt");
    clearWebAuthStorage();
    expect(localStorage.getItem(WEB_ACCESS_KEY)).toBeNull();
    expect(localStorage.getItem(WEB_REFRESH_KEY)).toBeNull();
    expect(resolveProtectedAuthGate({ loading: false, access: null })).toBe("login");
  });
});
