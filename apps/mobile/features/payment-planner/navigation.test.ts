import { describe, expect, it } from "vitest";
import { accountDetailPath, transactionsForAccountPath } from "@/features/payment-planner/navigation";

describe("payment planner navigation", () => {
  it("links to account details", () => {
    expect(accountDetailPath(42)).toBe("/account/42");
  });

  it("links to filtered transactions for the selected debt", () => {
    expect(transactionsForAccountPath(7)).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: { account: "7" },
    });
  });
});
