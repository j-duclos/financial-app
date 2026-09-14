import {
  getEffectiveDisplayName,
  HOME_ACCOUNT_PIN_LIMIT,
  type Account,
} from "@budget-app/shared";
import { accountLifecycleStatus } from "@/lib/accountGroups";
import { resolveListPrimaryBalance } from "@/features/accounts/accountBalanceDisplay";

export const HOME_ACCOUNT_PREVIEW_LIMIT = HOME_ACCOUNT_PIN_LIMIT;

/**
 * Home preview rank (lower = more useful).
 *
 * 1. Active checking
 * 2. Active savings
 * 3. Active credit cards with a non-zero official list balance
 * 4. Other active cash / depository (CASH, cash_reserve)
 * 5. Other active accounts with a non-zero official list balance
 * 6. Remaining active zero-balance accounts
 * 7. Closed / archived / inactive / deleted — only used if active accounts cannot fill the preview
 */
const RANK_ACTIVE_CHECKING = 10;
const RANK_ACTIVE_SAVINGS = 20;
const RANK_ACTIVE_CREDIT_NONZERO = 30;
const RANK_ACTIVE_CASH_DEPOSITORY = 40;
const RANK_ACTIVE_OTHER_NONZERO = 50;
const RANK_ACTIVE_ZERO_BALANCE = 60;
const RANK_INACTIVE = 70;

function isActiveAccount(account: Account): boolean {
  return accountLifecycleStatus(account) === "active";
}

function isChecking(account: Account): boolean {
  return account.account_type === "CHECKING";
}

function isSavings(account: Account): boolean {
  return account.account_type === "SAVINGS";
}

function isCreditCard(account: Account): boolean {
  return account.account_type === "CREDIT" || account.role === "credit_card";
}

function isOtherCashDepository(account: Account): boolean {
  return account.account_type === "CASH" || account.role === "cash_reserve";
}

/** Official list primary amount is missing or numerically zero — no new financial math. */
export function isHomePreviewZeroBalance(account: Account): boolean {
  const raw = resolveListPrimaryBalance(account).amount;
  if (raw == null) return true;
  const value = parseFloat(raw);
  return !Number.isFinite(value) || value === 0;
}

export function homePreviewAccountRank(account: Account): number {
  if (!isActiveAccount(account)) return RANK_INACTIVE;
  if (isChecking(account)) return RANK_ACTIVE_CHECKING;
  if (isSavings(account)) return RANK_ACTIVE_SAVINGS;
  const zero = isHomePreviewZeroBalance(account);
  if (isCreditCard(account) && !zero) return RANK_ACTIVE_CREDIT_NONZERO;
  if (isOtherCashDepository(account)) return RANK_ACTIVE_CASH_DEPOSITORY;
  if (!zero) return RANK_ACTIVE_OTHER_NONZERO;
  return RANK_ACTIVE_ZERO_BALANCE;
}

function compareDisplayName(a: Account, b: Account): number {
  return getEffectiveDisplayName(a).localeCompare(getEffectiveDisplayName(b), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * Most useful Home preview accounts. Does not mutate `accounts`.
 * Within the same rank, keeps API order (original index), then display name.
 */
export function rankHomePreviewAccounts(accounts: readonly Account[]): Account[] {
  return accounts
    .map((account, index) => ({ account, index }))
    .sort((a, b) => {
      const rankDelta = homePreviewAccountRank(a.account) - homePreviewAccountRank(b.account);
      if (rankDelta !== 0) return rankDelta;
      const indexDelta = a.index - b.index;
      if (indexDelta !== 0) return indexDelta;
      return compareDisplayName(a.account, b.account);
    })
    .map(({ account }) => account);
}

export function isHomePreviewActive(account: Account): boolean {
  return accountLifecycleStatus(account) === "active";
}

/** Stored pin reserved for Home; inactive/closed pins are kept but not shown. */
export function isHomePinnedAccount(account: Account): boolean {
  return account.pinned_to_home === true;
}

function pinOrder(account: Account): number {
  const order = account.home_pin_order;
  return order != null && Number.isFinite(order) ? order : 99;
}

/**
 * Home preview: active pins first (by home_pin_order), then automatic ranking.
 * Closed/inactive pins keep their stored state but are omitted unless needed to fill slots.
 * Does not mutate `accounts`.
 */
export function resolveHomePreviewAccounts(accounts: readonly Account[]): Account[] {
  const seen = new Set<number>();
  const preview: Account[] = [];

  const activePins = accounts
    .filter((account) => isHomePinnedAccount(account) && isHomePreviewActive(account))
    .slice()
    .sort((a, b) => {
      const orderDelta = pinOrder(a) - pinOrder(b);
      if (orderDelta !== 0) return orderDelta;
      return a.id - b.id;
    });

  for (const account of activePins) {
    if (seen.has(account.id)) continue;
    seen.add(account.id);
    preview.push(account);
    if (preview.length >= HOME_ACCOUNT_PREVIEW_LIMIT) return preview;
  }

  for (const account of rankHomePreviewAccounts(accounts.filter((item) => !seen.has(item.id)))) {
    if (seen.has(account.id)) continue;
    seen.add(account.id);
    preview.push(account);
    if (preview.length >= HOME_ACCOUNT_PREVIEW_LIMIT) break;
  }

  return preview;
}
