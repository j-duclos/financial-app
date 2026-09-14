import { Alert } from "react-native";
import { useCallback, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import {
  ApiError,
  createCheckoutSession,
  createPortalSession,
  resendVerification,
} from "@budget-app/api-client";
import { describeApiError } from "@/services/api";
import { logBillingCheckoutErrorIfDev } from "@/lib/billingCheckoutError";
import {
  ALREADY_PREMIUM_MESSAGE,
  BILLING_STATUS_QUERY_KEY,
  BILLING_UNAVAILABLE_MESSAGE,
  EMAIL_VERIFY_BEFORE_UPGRADE_MESSAGE,
  EMAIL_VERIFY_BEFORE_UPGRADE_TITLE,
  RESEND_VERIFICATION_EMAIL_LABEL,
  isEmailVerificationRequiredError,
} from "@/lib/billing";
import { PremiumUpgradeContext } from "@/features/billing/premiumUpgradeContext";
import { canUseStripeBilling } from "@/features/billing/billingProvider";
import {
  PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE,
  PREMIUM_NOT_NOW_LABEL,
  PREMIUM_SHEET_TITLE,
  PREMIUM_UPGRADE_CTA_LABEL,
} from "@/features/billing/premiumUpgradeCopy";

function upgradeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return ALREADY_PREMIUM_MESSAGE;
    const msg = error.message || "";
    if (
      error.status >= 500 ||
      error.status === 503 ||
      /<!doctype html|<html[\s>]|<\/html>/i.test(msg) ||
      /not configured/i.test(msg) ||
      /STRIPE_|SECRET|whsec_|sk_live|sk_test/i.test(msg)
    ) {
      return BILLING_UNAVAILABLE_MESSAGE;
    }
    return msg || BILLING_UNAVAILABLE_MESSAGE;
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

async function resendVerificationEmail(): Promise<void> {
  try {
    const result = await resendVerification();
    Alert.alert("Verification email", result.detail || "Verification email sent.");
  } catch (err) {
    Alert.alert("Couldn’t send email", describeApiError(err));
  }
}

/** Stripe Checkout + Customer Portal. Does not change entitlement rules. */
export function usePremiumCheckout() {
  const queryClient = useQueryClient();
  const [upgrading, setUpgrading] = useState(false);
  const stripeAllowed = canUseStripeBilling();

  const startUpgrade = useCallback(async () => {
    if (!stripeAllowed) {
      Alert.alert(PREMIUM_SHEET_TITLE, PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE);
      return;
    }
    setUpgrading(true);
    try {
      const session = await createCheckoutSession();
      if (!session.url) {
        Alert.alert("Upgrade", "Checkout could not be started. Please try again.");
        return;
      }
      await WebBrowser.openBrowserAsync(session.url);
      await queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
    } catch (err) {
      logBillingCheckoutErrorIfDev(err);
      if (isEmailVerificationRequiredError(err)) {
        Alert.alert(EMAIL_VERIFY_BEFORE_UPGRADE_TITLE, EMAIL_VERIFY_BEFORE_UPGRADE_MESSAGE, [
          { text: PREMIUM_NOT_NOW_LABEL, style: "cancel" },
          {
            text: RESEND_VERIFICATION_EMAIL_LABEL,
            onPress: () => void resendVerificationEmail(),
          },
        ]);
        return;
      }
      Alert.alert("Upgrade", upgradeErrorMessage(err));
    } finally {
      setUpgrading(false);
    }
  }, [queryClient, stripeAllowed]);

  const startPortal = useCallback(async () => {
    if (!stripeAllowed) {
      Alert.alert(PREMIUM_SHEET_TITLE, PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE);
      return;
    }
    try {
      const session = await createPortalSession();
      if (!session.url) {
        Alert.alert("Billing", "The billing portal could not be opened. Please try again.");
        return;
      }
      await WebBrowser.openBrowserAsync(session.url);
      await queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
    } catch (err) {
      Alert.alert("Billing", upgradeErrorMessage(err));
    }
  }, [queryClient, stripeAllowed]);

  return { startUpgrade, startPortal, upgrading, stripeAllowed };
}

export function usePremiumUpgrade() {
  const checkout = usePremiumCheckout();
  const sheet = useContext(PremiumUpgradeContext);

  const promptUpgrade = useCallback(
    (contextMessage?: string) => {
      if (sheet) {
        sheet.promptUpgrade(contextMessage);
        return;
      }
      Alert.alert(PREMIUM_SHEET_TITLE, contextMessage ?? PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE, [
        { text: PREMIUM_NOT_NOW_LABEL, style: "cancel" },
        ...(checkout.stripeAllowed
          ? [{ text: PREMIUM_UPGRADE_CTA_LABEL, onPress: () => void checkout.startUpgrade() }]
          : []),
      ]);
    },
    [checkout, sheet]
  );

  return { ...checkout, promptUpgrade };
}
