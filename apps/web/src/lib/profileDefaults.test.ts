import { describe, expect, it } from "vitest";
import {
  accountsForHousehold,
  nextDefaultAccountId,
} from "./profileDefaults";

const accounts = [
  { id: 1, household: { id: 10 } },
  { id: 2, household: { id: 10 } },
  { id: 3, household: { id: 20 } },
];

describe("accountsForHousehold", () => {
  it("returns only accounts for the selected household", () => {
    expect(accountsForHousehold(accounts, 10).map((a) => a.id)).toEqual([1, 2]);
    expect(accountsForHousehold(accounts, 20).map((a) => a.id)).toEqual([3]);
    expect(accountsForHousehold(accounts, "")).toEqual([]);
  });
});

describe("nextDefaultAccountId", () => {
  it("clears an account that belongs to the previous household", () => {
    expect(nextDefaultAccountId(1, 20, accounts)).toBe("");
    expect(nextDefaultAccountId(1, "", accounts)).toBe("");
  });

  it("keeps the current account until the list is loaded", () => {
    expect(nextDefaultAccountId(1, 10, [])).toBe(1);
  });
});
