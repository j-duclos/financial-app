import type { QueryClient } from "@tanstack/react-query";
import type { Account } from "@budget-app/shared";
import { HOME_ACCOUNT_PIN_LIMIT } from "@budget-app/shared";
import { accountQueryKeys } from "./queryKeys";

export function countPinnedHomeAccounts(accounts: readonly Account[]): number {
  return accounts.filter((account) => account.pinned_to_home === true).length;
}

export function canPinAnotherHomeAccount(accounts: readonly Account[], accountId: number): boolean {
  const target = accounts.find((account) => account.id === accountId);
  if (target?.pinned_to_home) return true;
  return countPinnedHomeAccounts(accounts) < HOME_ACCOUNT_PIN_LIMIT;
}

type AccountPage = { results?: Account[] };

export function applyHomePinPatchToQueryData(
  data: unknown,
  accountId: number,
  patch: Pick<Account, "pinned_to_home" | "home_pin_order">
): unknown {
  if (!data || typeof data !== "object") return data;
  if ("results" in data && Array.isArray((data as AccountPage).results)) {
    const page = data as AccountPage;
    return {
      ...page,
      results: page.results?.map((account) =>
        account.id === accountId ? { ...account, ...patch } : account
      ),
    };
  }
  if ("id" in data && (data as Account).id === accountId) {
    return { ...(data as Account), ...patch };
  }
  return data;
}

/** Optimistic / post-success pin fields on every cached account list and detail. */
export function patchHomePinInAccountCaches(
  queryClient: QueryClient,
  accountId: number,
  patch: Pick<Account, "pinned_to_home" | "home_pin_order">
): void {
  queryClient.setQueriesData({ queryKey: ["accounts"] }, (data) =>
    applyHomePinPatchToQueryData(data, accountId, patch)
  );
  queryClient.setQueriesData({ queryKey: ["account", accountId] }, (data) =>
    applyHomePinPatchToQueryData(data, accountId, patch)
  );
  queryClient.setQueryData(accountQueryKeys.balanceDetail(accountId), (data) =>
    applyHomePinPatchToQueryData(data, accountId, patch)
  );
}
