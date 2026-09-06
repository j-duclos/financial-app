import { Alert } from "react-native";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { ApiError, createCheckoutSession } from "@budget-app/api-client";
import {
  ALREADY_PREMIUM_MESSAGE,
  BILLING_STATUS_QUERY_KEY,
  BILLING_UNAVAILABLE_MESSAGE,
  EMAIL_VERIFICATION_REQUIRED_CODE,
  EMAIL_VERIFICATION_REQUIRED_MESSAGE,
  UPGRADE_TO_PREMIUM_LABEL,
} from "@/lib/billing";

function isEmailVerificationRequiredError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === EMAIL_VERIFICATION_REQUIRED_CODE) return true;
  return err.status === 403 && /verify your email before subscribing/i.test(err.message ?? "");
}

function upgradeErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return ALREADY_PREMIUM_MESSAGE;
    if (isEmailVerificationRequiredError(error)) return EMAIL_VERIFICATION_REQUIRED_MESSAGE;
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
