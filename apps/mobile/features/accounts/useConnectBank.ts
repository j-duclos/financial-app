import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  syncAllPlaidItems,
} from "@budget-app/api-client";
import { canUsePlaidBankSync } from "@budget-app/shared";
import { getAndroidPackageName } from "@/constants/env";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";
import { PREMIUM_UPGRADE_CONTEXT } from "@/features/billing";
import { describeApiError } from "@/services/api";
import { refreshAfterPlaidSync } from "@/lib/financialQueryRefresh";
import { recordPlaidRefreshTiming } from "@/lib/startupTrace";
import { openNativePlaidLink, PlaidLinkUnavailableError } from "./openNativePlaidLink";

export function useConnectBank() {
  const queryClient = useQueryClient();
  const { billing } = useBillingStatus();
  const { householdId, isReady } = useDefaultHouseholdId();
  const { promptUpgrade } = usePremiumUpgrade();
  const plaidAllowed = canUsePlaidBankSync(billing);
  const [busy, setBusy] = useState(false);

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
    if (busy) return;
    setBusy(true);
    try {
      const { link_token } = await createPlaidLinkToken(
        householdId,
        Platform.OS === "android" ? { android_package_name: getAndroidPackageName() } : undefined
      );
      const publicToken = await openNativePlaidLink(link_token);
      if (!publicToken) return;
      await exchangePlaidPublicToken({ public_token: publicToken, household_id: householdId });
      const started = Date.now();
      try {
        const sync = await syncAllPlaidItems({ household: householdId, force: true });
        const totals = sync.totals ?? {};
        recordPlaidRefreshTiming({
          durationMs: Date.now() - started,
          changedData: (totals.added ?? 0) + (totals.modified ?? 0) + (totals.merged ?? 0) > 0,
        });
      } catch {
        recordPlaidRefreshTiming({ durationMs: Date.now() - started, changedData: false });
      }
      refreshAfterPlaidSync(queryClient);
      Alert.alert("Bank connected", "Imported accounts will show on this screen after refresh.");
    } catch (err) {
      if (err instanceof PlaidLinkUnavailableError) {
        Alert.alert("Rebuild required", err.message);
        return;
      }
      Alert.alert("Couldn’t connect bank", describeApiError(err));
    } finally {
      setBusy(false);
    }
  }, [busy, householdId, isReady, plaidAllowed, promptUpgrade, queryClient]);

  return { connectBank, busy, plaidAllowed };
}
