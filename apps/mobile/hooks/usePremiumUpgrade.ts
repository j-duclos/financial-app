import { Alert } from "react-native";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { ApiError, createCheckoutSession, resendVerification } from "@budget-app/api-client";
import { describeApiError } from "@/services/api";
import {
  ALREADY_PREMIUM_MESSAGE,
  BILLING_STATUS_QUERY_KEY,
  BILLING_UNAVAILABLE_MESSAGE,
  EMAIL_VERIFY_BEFORE_UPGRADE_MESSAGE,
  EMAIL_VERIFY_BEFORE_UPGRADE_TITLE,
  RESEND_VERIFICATION_EMAIL_LABEL,
  UPGRADE_TO_PREMIUM_LABEL,
  isEmailVerificationRequiredError,
} from "@/lib/billing";

function upgradeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return ALREADY_PREMIUM_MESSAGE;
    const msg = error.message || "";
    if (
      error.status === 503 ||
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

export function usePremiumUpgrade() {
  const queryClient = useQueryClient();

  const startUpgrade = useCallback(async () => {
    try {
      const session = await createCheckoutSession();
      if (!session.url) {
        Alert.alert("Upgrade", "Checkout could not be started. Please try again.");
        return;
      }
      await WebBrowser.openBrowserAsync(session.url);
      await queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
    } catch (err) {
      if (isEmailVerificationRequiredError(err)) {
        Alert.alert(EMAIL_VERIFY_BEFORE_UPGRADE_TITLE, EMAIL_VERIFY_BEFORE_UPGRADE_MESSAGE, [
          { text: "Not now", style: "cancel" },
          {
            text: RESEND_VERIFICATION_EMAIL_LABEL,
            onPress: () => void resendVerificationEmail(),
          },
        ]);
        return;
      }
      Alert.alert("Upgrade", upgradeErrorMessage(err));
    }
  }, [queryClient]);

  const promptUpgrade = useCallback(
    (title: string, message: string) => {
      Alert.alert(title, message, [
        { text: "Not now", style: "cancel" },
        { text: UPGRADE_TO_PREMIUM_LABEL, onPress: () => void startUpgrade() },
      ]);
    },
    [startUpgrade]
  );

  return { startUpgrade, promptUpgrade };
}
