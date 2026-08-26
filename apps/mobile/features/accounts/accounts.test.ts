import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import { groupAccountsByType } from "@/lib/accountGroups";
import { countActiveTransactionFilters, DEFAULT_TRANSACTION_FILTERS } from "@/features/transactions/types";

const account = (partial: Partial<Account> & Pick<Account, "id" | "account_type" | "name">): Account =>
  ({
    household: { id: 1, name: "Home" } as Account["household"],
    role: "spending",
    institution: "Bank",
    currency: "USD",
    is_active: true,
    created_at: "",
    updated_at: "",
    ...partial,
  }) as Account;

describe("groupAccountsByType", () => {
  it("groups accounts by type in canonical order", () => {
    const groups = groupAccountsByType([
      account({ id: 1, account_type: "CREDIT", name: "Card" }),
      account({ id: 2, account_type: "CHECKING", name: "Checking" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["CHECKING", "CREDIT"]);
  });
});

describe("transaction filters", () => {
  it("counts active filters excluding search text", () => {
    expect(countActiveTransactionFilters(DEFAULT_TRANSACTION_FILTERS)).toBe(0);
    expect(
      countActiveTransactionFilters({
        ...DEFAULT_TRANSACTION_FILTERS,
        accountId: 3,
        showReconciled: true,
      })
    ).toBe(2);
  });
});
