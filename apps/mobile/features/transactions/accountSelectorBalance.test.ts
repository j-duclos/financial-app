import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import { formatAccountSelectorBalanceLine } from "./accountSelectorBalance";

const dir = dirname(fileURLToPath(import.meta.url));
const sheetSource = readFileSync(join(dir, "AccountSelectorSheet.tsx"), "utf8");

function cash(overrides: Partial<Account> = {}): Account {
  return {
    id: 1,
    household: 1,
    name: "Checking",
    account_type: "CHECKING",
    role: "spending",
    currency: "USD",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Account;
}

describe("formatAccountSelectorBalanceLine", () => {
  it("uses ledger Current, not Plaid current_balance on cash accounts", () => {
    expect(
      formatAccountSelectorBalanceLine(
        cash({
          current_balance: "12.00",
          starting_balance: "9999.00",
          available_balance: "415.85",
          balance: "415.85",
        })
      )
    ).toBe("Current $415.85");
  });

  it("uses credit ledger owed, not a leftover Plaid snapshot when signed balance is present", () => {
    expect(
      formatAccountSelectorBalanceLine(
        cash({
          id: 2,
          name: "Visa",
          account_type: "CREDIT",
          role: "credit",
          current_balance: "8000.00",
          balance_owed: "210.50",
          balance: "-210.50",
        })
      )
    ).toBe("Owed $210.50");
  });

  it("returns null when ledger amounts are missing so picker metadata is not shown", () => {
    expect(
      formatAccountSelectorBalanceLine(
        cash({
          current_balance: "12.00",
          starting_balance: "500.00",
        })
      )
    ).toBeNull();
  });
});

describe("AccountSelectorSheet ledger balances", () => {
  it("loads ?balance=true from the shared accounts main list cache", () => {
    expect(sheetSource).toMatch(/accountQueryKeys\.mainList/);
    expect(sheetSource).toMatch(/balance:\s*"true"/);
    expect(sheetSource).toMatch(/formatAccountSelectorBalanceLine\(balancesById\.get/);
    expect(sheetSource).not.toMatch(/available_balance \?\? account\.balance/);
  });
});
