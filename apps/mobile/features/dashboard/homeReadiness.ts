import { resolveListPrimaryBalance } from "@/features/accounts/accountBalanceDisplay";
import type { Account } from "@budget-app/shared";

/**
 * Home progressive-render rules.
 *
 * `isFetching` with existing data must never blank a section.
 * Only the absence of usable data (`isPending` / no payload) is a local skeleton.
 */

export function isHomeSectionPending(hasData: boolean): boolean {
  return !hasData;
}

export function isHomeFullScreenLoading(_input?: {
  onboardingPending?: boolean;
  summaryFastPending?: boolean;
  timelinePending?: boolean;
  isFetching?: boolean;
}): boolean {
  return false;
}

export function accountHasVisibleBalance(account: Account): boolean {
  return resolveListPrimaryBalance(account).amount != null;
}

export function hasVisibleHomeAccountBalances(accounts: readonly Account[]): boolean {
  return accounts.some(accountHasVisibleBalance);
}

export function hasOfficialHomeBalances(top: { liquid_cash?: string; available_credit?: string } | null): boolean {
  if (!top) return false;
  return top.liquid_cash != null || top.available_credit != null;
}

/**
 * Meaningful Home financial data: official Available Cash/Credit, or at least
 * one account row with an official API balance field.
 * Component mount alone is never enough.
 */
export function isHomePrimaryContentVisible(input: {
  accountsWithVisibleBalance: boolean;
  officialTopSummary: boolean;
}): boolean {
  return input.accountsWithVisibleBalance || input.officialTopSummary;
}

export function shouldStartHomeAccountsQuery(isAuthenticated: boolean): boolean {
  return isAuthenticated;
}

export function shouldStartHomeSummaryFast(isAuthenticated: boolean): boolean {
  return isAuthenticated;
}

export function shouldShowHomeFirstRun(input: {
  onboardingPending: boolean;
  missingAccounts: boolean;
}): boolean {
  if (input.onboardingPending) return false;
  return input.missingAccounts;
}

export function shouldShowHomeAccountBalancesSection(input: {
  firstRun: boolean;
  accountsPending: boolean;
  accounts: readonly Account[];
}): boolean {
  if (input.firstRun) return false;
  return input.accountsPending || input.accounts.length > 0;
}

/** Cached/placeholder payloads stay visible while a background refetch runs. */
export function isHomeRefetchingWithData(hasData: boolean, isFetching: boolean): boolean {
  return hasData && isFetching;
}
