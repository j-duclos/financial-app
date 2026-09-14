import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_ACCOUNT_PIN_LIMIT, HOME_ACCOUNT_PIN_LIMIT_MESSAGE, type Account } from "@budget-app/shared";
import {
  applyHomePinPatchToQueryData,
  canPinAnotherHomeAccount,
  countPinnedHomeAccounts,
} from "./homeAccountPin";

const account = (partial: Partial<Account> & Pick<Account, "id" | "name">): Account =>
  ({
    household: { id: 1, name: "Home" } as Account["household"],
    account_type: "CHECKING",
    role: "spending",
    institution: "Bank",
    currency: "USD",
    is_active: true,
    status: "active",
    created_at: "",
    updated_at: "",
    ...partial,
  }) as Account;

describe("homeAccountPin helpers", () => {
  it("counts pinned accounts and allows unpin when already at the limit", () => {
    const accounts = [
      account({ id: 1, name: "A", pinned_to_home: true, home_pin_order: 1 }),
      account({ id: 2, name: "B", pinned_to_home: true, home_pin_order: 2 }),
      account({ id: 3, name: "C", pinned_to_home: true, home_pin_order: 3 }),
      account({ id: 4, name: "D", pinned_to_home: true, home_pin_order: 4 }),
      account({ id: 5, name: "E" }),
    ];
    expect(countPinnedHomeAccounts(accounts)).toBe(HOME_ACCOUNT_PIN_LIMIT);
    expect(canPinAnotherHomeAccount(accounts, 5)).toBe(false);
    expect(canPinAnotherHomeAccount(accounts, 1)).toBe(true);
  });

  it("patches list and detail caches without mutating the source page", () => {
    const page = {
      results: [
        account({ id: 1, name: "A" }),
        account({ id: 2, name: "B", pinned_to_home: true, home_pin_order: 1 }),
      ],
    };
    const original = page.results;
    const next = applyHomePinPatchToQueryData(page, 1, {
      pinned_to_home: true,
      home_pin_order: 2,
    }) as { results: Account[] };
    expect(next.results[0]?.pinned_to_home).toBe(true);
    expect(next.results[0]?.home_pin_order).toBe(2);
    expect(original[0]?.pinned_to_home).toBeUndefined();
    expect(page.results).toBe(original);
  });
});

describe("home pin UI and mutation wiring", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const hook = readFileSync(join(dir, "useHomeAccountPin.ts"), "utf8");
  const row = readFileSync(join(dir, "AccountRow.tsx"), "utf8");
  const detail = readFileSync(join(dir, "AccountDetailScreen.tsx"), "utf8");
  const accounts = readFileSync(join(dir, "AccountsScreen.tsx"), "utf8");

  it("blocks a fifth pin with the shared message and does not replace another pin", () => {
    expect(hook).toMatch(/HOME_ACCOUNT_PIN_LIMIT_MESSAGE/);
    expect(hook).toMatch(/Alert\.alert\("Home pin", HOME_ACCOUNT_PIN_LIMIT_MESSAGE\)/);
    expect(hook).not.toMatch(/replace/);
    expect(HOME_ACCOUNT_PIN_LIMIT_MESSAGE).toBe(
      "You can pin up to 4 accounts to Home. Unpin one first."
    );
  });

  it("updates Home via optimistic account-cache patch and metadata invalidation only", () => {
    expect(hook).toMatch(/patchHomePinInAccountCaches/);
    expect(hook).toMatch(/invalidateAfterAccountMetadataEdit/);
    expect(hook).not.toMatch(/invalidateAfterAccountFinancialMutation/);
    expect(hook).toMatch(/updateAccount\(input\.account\.id, \{ pinned_to_home: input\.pinned \}\)/);
  });

  it("exposes pin and unpin controls on Accounts rows and Account Detail", () => {
    expect(row).toMatch(/Pin to Home/);
    expect(row).toMatch(/Unpin from Home/);
    expect(row).toMatch(/onToggleHomePin/);
    expect(detail).toMatch(/label=\{account\.pinned_to_home \? "Pinned to Home" : "Pin to Home"\}/);
    expect(detail).toMatch(/accessibilityLabel=\{account\.pinned_to_home \? "Unpin from Home" : "Pin to Home"\}/);
    expect(accounts).toMatch(/onToggleHomePin=\{\(\) => toggleHomePin\(account\)\}/);
    expect(accounts).toMatch(/groupAccountsByType/);
  });
});
