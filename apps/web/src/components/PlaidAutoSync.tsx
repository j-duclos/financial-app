import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getPlaidMeta, getProfile, syncAllPlaidItems } from "@budget-app/api-client";
import { useAuth } from "../context/AuthContext";
import {
  invalidateQueriesAfterPlaidSync,
  markPlaidAutoSyncRan,
  shouldSkipPlaidAutoSync,
} from "../lib/plaidSyncUtils";

/**
 * Fire-and-forget Plaid import when the app loads (authenticated users with Plaid configured).
 * Does not block rendering; skips if synced within the last ~5 minutes (session + server throttle).
 */
export function usePlaidAutoSync() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const startedRef = useRef(false);

  useEffect(() => {
    if (auth.loading || !auth.access || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        const meta = await getPlaidMeta();
        if (!meta.plaid_configured) return;

        const profile = await getProfile();
        if (shouldSkipPlaidAutoSync(profile.id)) return;

        const result = await syncAllPlaidItems({
          household: profile.default_household ?? undefined,
          force: false,
        });
        markPlaidAutoSyncRan(profile.id);

        const totals = result.totals;
        const hadActivity =
          (totals.synced_items ?? 0) > 0 ||
          (totals.added ?? 0) + (totals.modified ?? 0) + (totals.removed ?? 0) > 0;
        if (hadActivity) {
          await invalidateQueriesAfterPlaidSync(queryClient);
        }
      } catch {
        /* background — cold starts and Plaid delays should not surface as errors on load */
      }
    })();
  }, [auth.access, auth.loading, queryClient]);
}

export function PlaidAutoSync() {
  usePlaidAutoSync();
  return null;
}
