import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getPlaidMeta, syncAllPlaidItems } from "@budget-app/api-client";
import { useAuth } from "../context/AuthContext";
import {
  canRunPlaidAutoSync,
  dispatchPlaidAutoSyncEvent,
  invalidateQueriesAfterPlaidSync,
  markPlaidAutoSyncAttempt,
  msSinceLastPlaidAutoSync,
  PLAID_AUTO_SYNC_VISIBILITY_MS,
  plaidAutoSyncSummary,
} from "../lib/plaidSyncUtils";

/**
 * Import from every linked Plaid login when the app opens or the tab becomes visible again.
 * Uses force=true so server-side "synced 5 minutes ago" throttling cannot skip new bank posts.
 */
export function usePlaidAutoSync() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);

  const runAutoSync = useCallback(
    async (reason: "app_open" | "tab_visible") => {
      if (inFlightRef.current) return;
      if (!canRunPlaidAutoSync()) return;

      inFlightRef.current = true;
      markPlaidAutoSyncAttempt();

      try {
        const meta = await getPlaidMeta();
        if (!meta.plaid_configured) return;

        const result = await syncAllPlaidItems({ force: true });
        await invalidateQueriesAfterPlaidSync(queryClient);

        const summary = plaidAutoSyncSummary(result);
        dispatchPlaidAutoSyncEvent({ ok: true, summary });
        if (import.meta.env.DEV && summary) {
          console.info(`[Plaid auto-sync ${reason}] ${summary}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Bank import failed";
        dispatchPlaidAutoSyncEvent({ ok: false, summary: null, error: message });
        console.warn(`[Plaid auto-sync ${reason}]`, err);
      } finally {
        inFlightRef.current = false;
      }
    },
    [queryClient]
  );

  useEffect(() => {
    if (auth.loading || !auth.access) return;
    void runAutoSync("app_open");
  }, [auth.access, auth.loading, runAutoSync]);

  useEffect(() => {
    if (auth.loading || !auth.access) return;

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (msSinceLastPlaidAutoSync() < PLAID_AUTO_SYNC_VISIBILITY_MS) return;
      void runAutoSync("tab_visible");
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [auth.access, auth.loading, runAutoSync]);
}

export function PlaidAutoSync() {
  usePlaidAutoSync();
  return null;
}
