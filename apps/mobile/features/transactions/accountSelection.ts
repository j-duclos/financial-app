import type { Account } from "@budget-app/shared";
import { groupAccountsByType } from "@/lib/accountGroups";
import {
  getLastViewedTransactionAccountId,
  setLastViewedTransactionAccountId,
} from "./transactionsSession";

export type ResolveInitialTransactionAccountInput = {
  routeAccountId: number | null;
  sessionAccountId?: number | null;
  defaultAccountId?: number | null;
  accounts: Account[];
};

function isActiveAccountId(accounts: Account[], accountId: number | null | undefined): accountId is number {
  return accountId != null && accounts.some((a) => a.id === accountId);
}

/** First active account in canonical type order (checking before savings before credit, …). */
export function firstCanonicalActiveAccountId(accounts: Account[]): number | null {
  const groups = groupAccountsByType(accounts);
  for (const group of groups) {
    const first = group.accounts[0];
    if (first) return first.id;
  }
  return null;
}

/**
 * Resolve which account ledger to show. Priority:
 * 1. Route-provided account ID
 * 2. Last account viewed this session
 * 3. Profile default account
 * 4. First active account in canonical order
 */
export function resolveInitialTransactionAccount(
  input: ResolveInitialTransactionAccountInput
): number | null {
  const sessionId = input.sessionAccountId ?? getLastViewedTransactionAccountId();

  if (isActiveAccountId(input.accounts, input.routeAccountId)) return input.routeAccountId;
  if (isActiveAccountId(input.accounts, sessionId)) return sessionId;
  if (isActiveAccountId(input.accounts, input.defaultAccountId ?? null)) {
    return input.defaultAccountId ?? null;
  }
  return firstCanonicalActiveAccountId(input.accounts);
}

export function rememberTransactionAccountSelection(accountId: number): void {
  setLastViewedTransactionAccountId(accountId);
}

export function parseRouteAccountId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const accountId = Number(value);
  if (Number.isInteger(accountId) && accountId > 0) return accountId;
  return null;
}
