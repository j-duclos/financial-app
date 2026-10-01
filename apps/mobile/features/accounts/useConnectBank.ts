import { useCallback, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { createPlaidLinkToken, exchangePlaidPublicToken } from "@budget-app/api-client";
import { canUsePlaidBankSync } from "@budget-app/shared";
import {
  isPlaidRedirectUriRejected,
  plaidLinkTokenCreateAttempts,
} from "./plaidLinkTokenOptions";
import {
  openNativePlaidLink,
  PlaidLinkExitError,
  PlaidLinkUnavailableError,
} from "./openNativePlaidLink";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";
import { PREMIUM_UPGRADE_CONTEXT } from "@/features/billing";
import { describeApiError } from "@/services/api";
import { refreshAfterPlaidSync } from "@/lib/financialQueryRefresh";
import { formatPlaidSyncSummary, runHouseholdPlaidSync } from "./plaidBankSync";

export function useConnectBank() {
  const queryClient = useQueryClient();
  const { billing } = useBillingStatus();
  const { householdId, isReady } = useDefaultHouseholdId();
  const { promptUpgrade } = usePremiumUpgrade();
  const plaidAllowed = canUsePlaidBankSync(billing);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const connectBank = useCallback(async () => {
    if (!plaidAllowed) {
      promptUpgrade(PREMIUM_UPGRADE_CONTEXT.bankSync);
      return;
    }
    if (!isReady) return;
    if (householdId == null) {
      Alert.alert("Household required", "Set a default household in Settings, then connect a bank.");
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const attempts = plaidLinkTokenCreateAttempts(Platform.OS);
      let link_token = "";
      for (let i = 0; i < attempts.length; i += 1) {
        try {
          ({ link_token } = await createPlaidLinkToken(householdId, attempts[i]));
          break;
        } catch (err) {
          const canRetry =
            i < attempts.length - 1 && isPlaidRedirectUriRejected(err);
          if (!canRetry) throw err;
        }
      }
      if (!link_token) {
        throw new Error("Plaid did not return a link token.");
      }
      setBusy(false);
      const publicToken = await openNativePlaidLink(link_token);
      if (!publicToken) return;
      await exchangePlaidPublicToken({ public_token: publicToken, household_id: householdId });
      try {
        const sync = await runHouseholdPlaidSync({
          householdId,
          force: true,
          queryClient,
        });
        const summary = formatPlaidSyncSummary(sync.totals ?? {});
        Alert.alert(
          "Bank connected",
          summary
            ? `Imported accounts and transactions: ${summary}.`
            : "Imported accounts will show on this screen. Pull to refresh or tap Sync banks if transactions are missing."
        );
      } catch (syncErr) {
        refreshAfterPlaidSync(queryClient);
        Alert.alert(
          "Bank connected, import incomplete",
          `${describeApiError(syncErr)} Pull to refresh or tap Sync banks to try importing transactions again.`
        );
      }
    } catch (err) {
      if (err instanceof PlaidLinkUnavailableError) {
        Alert.alert("Rebuild required", err.message);
        return;
      }
      if (err instanceof PlaidLinkExitError) {
        Alert.alert("Couldn’t connect bank", err.userMessage);
        return;
      }
      Alert.alert("Couldn’t connect bank", describeApiError(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [householdId, isReady, plaidAllowed, promptUpgrade, queryClient]);

  return { connectBank, busy, plaidAllowed };
}
