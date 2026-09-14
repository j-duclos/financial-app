import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Account } from "@budget-app/shared";
import {
  HOME_ACCOUNT_PREVIEW_LIMIT,
  homePreviewAccountRank,
  isHomePreviewZeroBalance,
  rankHomePreviewAccounts,
  resolveHomePreviewAccounts,
} from "./homePreviewAccounts";

const account = (partial: Partial<Account> & Pick<Account, "id" | "account_type" | "name">): Account =>
  ({
    household: { id: 1, name: "Home" } as Account["household"],
    role: "spending",
    institution: "Bank",
    currency: "USD",
    is_active: true,
    status: "active",
    created_at: "",
    updated_at: "",
    ...partial,
  }) as Account;

describe("rankHomePreviewAccounts", () => {
  it("ranks checking before savings before credit cards", () => {
    const card = account({
      id: 1,
      account_type: "CREDIT",
      name: "Visa",
      role: "credit_card",
      balance_owed: "200.00",
    });
    const savings = account({
      id: 2,
      account_type: "SAVINGS",
      name: "Rainy",
      available_balance: "50.00",
    });
    const checking = account({
      id: 3,
      account_type: "CHECKING",
      name: "Main",
      available_balance: "10.00",
    });
    expect(rankHomePreviewAccounts([card, savings, checking]).map((a) => a.id)).toEqual([3, 2, 1]);
  });

  it("ranks a nonzero credit card before a zero-balance card", () => {
    const paidOff = account({
      id: 1,
      account_type: "CREDIT",
      name: "Store card",
      role: "credit_card",
      balance_owed: "0.00",
    });
    const carrying = account({
      id: 2,
      account_type: "CREDIT",
      name: "Visa",
      role: "credit_card",
      balance_owed: "140.00",
    });
    expect(rankHomePreviewAccounts([paidOff, carrying]).map((a) => a.id)).toEqual([2, 1]);
    expect(isHomePreviewZeroBalance(paidOff)).toBe(true);
    expect(isHomePreviewZeroBalance(carrying)).toBe(false);
  });

  it("does not let a zero-balance account displace checking, savings, or a card with a balance", () => {
    const zeroCash = account({
      id: 1,
      account_type: "CASH",
      name: "Wallet",
      available_balance: "0.00",
    });
    const checking = account({
      id: 2,
      account_type: "CHECKING",
      name: "Checking",
      available_balance: "80.00",
    });
    const savings = account({
      id: 3,
      account_type: "SAVINGS",
      name: "Savings",
      available_balance: "20.00",
    });
    const card = account({
      id: 4,
      account_type: "CREDIT",
      name: "Card",
      role: "credit_card",
      balance_owed: "15.00",
    });
    const extraZero = account({
      id: 5,
      account_type: "CREDIT",
      name: "Paid off",
      role: "credit_card",
      balance_owed: "0.00",
    });
    const ranked = rankHomePreviewAccounts([extraZero, zeroCash, card, savings, checking]);
    expect(ranked.slice(0, 4).map((a) => a.id)).toEqual([2, 3, 4, 1]);
    expect(ranked.slice(0, 4).map((a) => a.id)).not.toContain(5);
  });

  it("ranks closed and inactive accounts last", () => {
    const closedChecking = account({
      id: 1,
      account_type: "CHECKING",
      name: "Old checking",
      status: "closed",
      is_active: false,
      available_balance: "5.00",
    });
    const archived = account({
      id: 2,
      account_type: "SAVINGS",
      name: "Archived",
      status: "archived",
      archived: true,
      is_active: false,
      available_balance: "9.00",
    });
    const inactive = account({
      id: 3,
      account_type: "CASH",
      name: "Inactive",
      status: "closed",
      is_active: false,
      available_balance: "4.00",
    });
    const activeCard = account({
      id: 4,
      account_type: "CREDIT",
      name: "Visa",
      role: "credit_card",
      balance_owed: "30.00",
    });
    const ranked = rankHomePreviewAccounts([closedChecking, archived, inactive, activeCard]);
    expect(ranked[0]?.id).toBe(4);
    expect(ranked.slice(1).map((a) => a.id)).toEqual([1, 2, 3]);
    expect(homePreviewAccountRank(closedChecking)).toBeGreaterThan(homePreviewAccountRank(activeCard));
  });

  it("uses closed/inactive accounts only when active accounts cannot fill the preview", () => {
    const closed = account({
      id: 9,
      account_type: "CHECKING",
      name: "Closed",
      status: "closed",
      is_active: false,
      available_balance: "1.00",
    });
    const actives = [
      account({ id: 1, account_type: "CHECKING", name: "A", available_balance: "1.00" }),
      account({ id: 2, account_type: "SAVINGS", name: "B", available_balance: "1.00" }),
      account({ id: 3, account_type: "CREDIT", name: "C", role: "credit_card", balance_owed: "1.00" }),
      account({ id: 4, account_type: "CASH", name: "D", available_balance: "1.00" }),
    ];
    expect(rankHomePreviewAccounts([...actives, closed]).slice(0, 4).map((a) => a.id)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(
      rankHomePreviewAccounts([closed, actives[0]!, actives[1]!])
        .slice(0, 4)
        .map((a) => a.id)
    ).toEqual([1, 2, 9]);
  });

  it("does not mutate the source array", () => {
    const source = [
      account({ id: 1, account_type: "CREDIT", name: "Card", role: "credit_card", balance_owed: "8.00" }),
      account({ id: 2, account_type: "CHECKING", name: "Checking", available_balance: "3.00" }),
    ];
    const copy = [...source];
    rankHomePreviewAccounts(source);
    expect(source).toEqual(copy);
    expect(source.map((a) => a.id)).toEqual([1, 2]);
  });

  it("is stable and deterministic for the same input", () => {
    const source = [
      account({ id: 4, account_type: "CHECKING", name: "Beta", available_balance: "1.00" }),
      account({ id: 5, account_type: "CHECKING", name: "Alpha", available_balance: "2.00" }),
      account({ id: 6, account_type: "SAVINGS", name: "Save", available_balance: "3.00" }),
    ];
    const first = rankHomePreviewAccounts(source).map((a) => a.id);
    const second = rankHomePreviewAccounts(source).map((a) => a.id);
    expect(first).toEqual(second);
    expect(first).toEqual([4, 5, 6]);
  });

  it("keeps API order within the same rank instead of sorting by balance", () => {
    const larger = account({
      id: 1,
      account_type: "CHECKING",
      name: "Bigger",
      available_balance: "900.00",
    });
    const smaller = account({
      id: 2,
      account_type: "CHECKING",
      name: "Smaller",
      available_balance: "5.00",
    });
    expect(rankHomePreviewAccounts([larger, smaller]).map((a) => a.id)).toEqual([1, 2]);
    expect(rankHomePreviewAccounts([smaller, larger]).map((a) => a.id)).toEqual([2, 1]);
  });

  it("returns all accounts when there are fewer than 4", () => {
    const source = [
      account({ id: 1, account_type: "CHECKING", name: "Only", available_balance: "12.00" }),
      account({ id: 2, account_type: "SAVINGS", name: "Two", available_balance: "3.00" }),
    ];
    expect(rankHomePreviewAccounts(source)).toHaveLength(2);
    expect(rankHomePreviewAccounts(source).map((a) => a.id)).toEqual([1, 2]);
  });

  it("ranks more than 4 accounts but Home preview still takes only 4", () => {
    const source = [
      account({ id: 10, account_type: "OTHER", name: "Other", available_balance: "1.00" }),
      account({ id: 11, account_type: "CREDIT", name: "Zero card", role: "credit_card", balance_owed: "0.00" }),
      account({ id: 12, account_type: "CASH", name: "Cash", available_balance: "2.00" }),
      account({ id: 13, account_type: "CREDIT", name: "Visa", role: "credit_card", balance_owed: "40.00" }),
      account({ id: 14, account_type: "SAVINGS", name: "Save", available_balance: "8.00" }),
      account({ id: 15, account_type: "CHECKING", name: "Check", available_balance: "6.00" }),
    ];
    const ranked = rankHomePreviewAccounts(source);
    expect(ranked).toHaveLength(6);
    expect(ranked.slice(0, HOME_ACCOUNT_PREVIEW_LIMIT).map((a) => a.id)).toEqual([15, 14, 13, 12]);
    expect(HOME_ACCOUNT_PREVIEW_LIMIT).toBe(4);
  });

  it("treats is_active false as inactive when status is omitted", () => {
    const inactive = account({
      id: 1,
      account_type: "CHECKING",
      name: "Legacy inactive",
      is_active: false,
      available_balance: "40.00",
    });
    delete inactive.status;
    const active = account({
      id: 2,
      account_type: "CASH",
      name: "Cash",
      available_balance: "1.00",
    });
    expect(rankHomePreviewAccounts([inactive, active]).map((a) => a.id)).toEqual([2, 1]);
  });

  it("fills remaining slots with zero-balance active accounts when needed", () => {
    const checking = account({
      id: 1,
      account_type: "CHECKING",
      name: "Main",
      available_balance: "10.00",
    });
    const zeroCard = account({
      id: 2,
      account_type: "CREDIT",
      name: "Store",
      role: "credit_card",
      balance_owed: "0.00",
    });
    expect(rankHomePreviewAccounts([zeroCard, checking]).map((a) => a.id)).toEqual([1, 2]);
  });
});

describe("resolveHomePreviewAccounts", () => {
  it("puts pinned accounts first in home_pin_order", () => {
    const checking = account({
      id: 1,
      account_type: "CHECKING",
      name: "Main",
      available_balance: "10.00",
    });
    const savings = account({
      id: 2,
      account_type: "SAVINGS",
      name: "Save",
      available_balance: "8.00",
      pinned_to_home: true,
      home_pin_order: 2,
    });
    const cash = account({
      id: 3,
      account_type: "CASH",
      name: "Cash",
      available_balance: "4.00",
      pinned_to_home: true,
      home_pin_order: 1,
    });
    expect(resolveHomePreviewAccounts([checking, savings, cash]).map((a) => a.id)).toEqual([
      3, 2, 1,
    ]);
  });

  it("fills remaining slots with automatic ranking when fewer than 4 are pinned", () => {
    const pinnedOther = account({
      id: 10,
      account_type: "OTHER",
      name: "Brokerage",
      available_balance: "1.00",
      pinned_to_home: true,
      home_pin_order: 1,
    });
    const checking = account({
      id: 11,
      account_type: "CHECKING",
      name: "Checking",
      available_balance: "20.00",
    });
    const savings = account({
      id: 12,
      account_type: "SAVINGS",
      name: "Savings",
      available_balance: "15.00",
    });
    const card = account({
      id: 13,
      account_type: "CREDIT",
      name: "Visa",
      role: "credit_card",
      balance_owed: "40.00",
    });
    const zeroCard = account({
      id: 14,
      account_type: "CREDIT",
      name: "Paid off",
      role: "credit_card",
      balance_owed: "0.00",
    });
    expect(
      resolveHomePreviewAccounts([zeroCard, card, savings, checking, pinnedOther]).map((a) => a.id)
    ).toEqual([10, 11, 12, 13]);
  });

  it("uses automatic ranking entirely when nothing is pinned", () => {
    const card = account({
      id: 1,
      account_type: "CREDIT",
      name: "Visa",
      role: "credit_card",
      balance_owed: "20.00",
    });
    const checking = account({
      id: 2,
      account_type: "CHECKING",
      name: "Main",
      available_balance: "5.00",
    });
    expect(resolveHomePreviewAccounts([card, checking]).map((a) => a.id)).toEqual([2, 1]);
    expect(resolveHomePreviewAccounts([card, checking]).map((a) => a.id)).toEqual(
      rankHomePreviewAccounts([card, checking]).map((a) => a.id)
    );
  });

  it("omits a closed pinned account from Home while preserving later fallback ranking", () => {
    const closedPinned = account({
      id: 1,
      account_type: "CHECKING",
      name: "Old",
      status: "closed",
      is_active: false,
      pinned_to_home: true,
      home_pin_order: 1,
      available_balance: "9.00",
    });
    const savings = account({
      id: 2,
      account_type: "SAVINGS",
      name: "Save",
      available_balance: "3.00",
    });
    const cash = account({
      id: 3,
      account_type: "CASH",
      name: "Cash",
      available_balance: "2.00",
    });
    expect(resolveHomePreviewAccounts([closedPinned, savings, cash]).map((a) => a.id)).toEqual([
      2, 3, 1,
    ]);
    expect(closedPinned.pinned_to_home).toBe(true);
  });

  it("does not let a closed pin occupy a Home slot when 4 active accounts exist", () => {
    const closedPinned = account({
      id: 99,
      account_type: "CHECKING",
      name: "Closed pin",
      status: "closed",
      is_active: false,
      pinned_to_home: true,
      home_pin_order: 1,
      available_balance: "1.00",
    });
    const actives = [
      account({ id: 1, account_type: "CHECKING", name: "A", available_balance: "1.00" }),
      account({ id: 2, account_type: "SAVINGS", name: "B", available_balance: "1.00" }),
      account({
        id: 3,
        account_type: "CREDIT",
        name: "C",
        role: "credit_card",
        balance_owed: "1.00",
      }),
      account({ id: 4, account_type: "CASH", name: "D", available_balance: "1.00" }),
    ];
    expect(resolveHomePreviewAccounts([closedPinned, ...actives]).map((a) => a.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("returns at most 4 accounts and does not mutate the source", () => {
    const source = [
      account({
        id: 1,
        account_type: "OTHER",
        name: "Pinned late",
        available_balance: "1.00",
        pinned_to_home: true,
        home_pin_order: 2,
      }),
      account({
        id: 2,
        account_type: "CASH",
        name: "Pinned first",
        available_balance: "1.00",
        pinned_to_home: true,
        home_pin_order: 1,
      }),
      account({ id: 3, account_type: "CHECKING", name: "Check", available_balance: "1.00" }),
      account({ id: 4, account_type: "SAVINGS", name: "Save", available_balance: "1.00" }),
      account({
        id: 5,
        account_type: "CREDIT",
        name: "Visa",
        role: "credit_card",
        balance_owed: "9.00",
      }),
    ];
    const copy = source.map((item) => ({ ...item }));
    const preview = resolveHomePreviewAccounts(source);
    expect(preview.map((a) => a.id)).toEqual([2, 1, 3, 4]);
    expect(preview).toHaveLength(HOME_ACCOUNT_PREVIEW_LIMIT);
    expect(source.map((a) => a.id)).toEqual(copy.map((a) => a.id));
    expect(source[0]?.home_pin_order).toBe(2);
  });
});

describe("Home account preview wiring", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const homeSection = readFileSync(join(dir, "HomeAccountBalancesSection.tsx"), "utf8");
  const accountsScreen = readFileSync(join(dir, "../accounts/AccountsScreen.tsx"), "utf8");

  it("renders at most 4 resolved Home cards", () => {
    expect(homeSection).toMatch(/resolveHomePreviewAccounts\(accounts\)/);
    expect(homeSection).not.toMatch(/accounts\.slice\(0,\s*4\)/);
    expect(homeSection).not.toMatch(/accounts\.slice\(0,\s*PREVIEW_LIMIT\)/);
    expect(HOME_ACCOUNT_PREVIEW_LIMIT).toBe(4);
  });

  it("does not change full Accounts list ordering", () => {
    expect(accountsScreen).not.toMatch(/rankHomePreviewAccounts/);
    expect(accountsScreen).not.toMatch(/resolveHomePreviewAccounts/);
    expect(accountsScreen).toMatch(/groupAccountsByType/);
  });
});
