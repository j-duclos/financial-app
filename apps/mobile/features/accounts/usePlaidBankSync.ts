import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getPlaidMeta } from "@budget-app/api-client";
import { canUsePlaidBankSync } from "@budget-app/shared";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { describeApiError } from "@/services/api";
import { formatPlaidSyncSummary, runHouseholdPlaidSync } from "./plaidBankSync";

type SyncBanksOptions = {
  /** Pull-to-refresh: only alert when import fails. */
  silent?: boolean;
};

export function usePlaidBankSync() {
  const queryClient = useQueryClient();
  const { billing } = useBillingStatus();
  const { householdId, isReady } = useDefaultHouseholdId();
  const plaidAllowed = canUsePlaidBankSync(billing);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const syncBanks = useCallback(
    async (options: SyncBanksOptions = {}) => {
      if (!plaidAllowed || !isReady || householdId == null) return null;
      if (inFlight.current) return null;
      inFlight.current = true;
      setBusy(true);
      try {
        const meta = await getPlaidMeta();
        if (!meta.plaid_configured) {
          if (!options.silent) {
            Alert.alert(
              "Bank import isn’t available",
              "This server has no Plaid configuration. Linked accounts cannot import transactions until that is set."
            );
          }
          return null;
        }
        const result = await runHouseholdPlaidSync({
          householdId,
          force: true,
          queryClient,
        });
        const totals = result.totals ?? {};
        const failed = (totals.failed_items ?? 0) > 0;
        const summary =
          formatPlaidSyncSummary(totals) ??
          (failed
            ? "Some bank logins could not import."
            : "No new transactions from the bank.");
        if (!options.silent || failed) {
          Alert.alert(failed ? "Bank sync finished with errors" : "Bank sync complete", summary);
        }
        return result;
      } catch (err) {
        Alert.alert("Couldn’t sync banks", describeApiError(err));
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [householdId, isReady, plaidAllowed, queryClient]
  );

  return { syncBanks, busy, plaidAllowed };
}
