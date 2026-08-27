import { describe, expect, it } from "vitest";
import { resolveHouseholdId } from "./householdContext";

describe("resolveHouseholdId", () => {
  const accounts = [
    { id: 1, household: { id: 10 } },
    { id: 2, household: { id: 20 } },
  ] as Array<{ id: number; household: { id: number } }>;

  it("uses profile default when no account filter is active", () => {
    expect(resolveHouseholdId(10, null, accounts as never)).toBe(10);
  });

  it("uses the selected account household when filtering", () => {
    expect(resolveHouseholdId(10, 2, accounts as never)).toBe(20);
  });

  it("falls back to default when account is unknown", () => {
    expect(resolveHouseholdId(10, 99, accounts as never)).toBe(10);
  });

  it("returns null when no default and no resolvable account", () => {
    expect(resolveHouseholdId(null, null, accounts as never)).toBeNull();
  });
});
