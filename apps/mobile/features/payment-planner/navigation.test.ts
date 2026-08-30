import { describe, expect, it } from "vitest";
import { accountDetailPath, transactionsForAccountPath } from "@/features/payment-planner/navigation";

describe("payment planner navigation", () => {
  it("links to account details", () => {
    expect(accountDetailPath(42)).toBe("/account/42");
  });

  it("links to filtered transactions for the selected debt", () => {
    const path = transactionsForAccountPath(7);
    expect(path.pathname).toBe("/(app)/(tabs)/transactions");
    expect(path.params.account).toBe("7");
    expect(path.params.focus).toBe("__none__");
  });
});
