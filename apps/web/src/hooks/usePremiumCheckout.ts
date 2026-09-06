import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, createCheckoutSession } from "@budget-app/api-client";
import { ALREADY_PREMIUM_MESSAGE, BILLING_STATUS_QUERY_KEY } from "../lib/billing";
import {
  billingActionErrorMessage,
  isEmailVerificationRequiredError,
  redirectToExternalUrl,
} from "../lib/billingDisplay";
import { useBillingStatus } from "./useBillingStatus";

export function usePremiumCheckout() {
  const queryClient = useQueryClient();
  const { refetch } = useBillingStatus();
  const [error, setError] = useState<string | null>(null);
  const [alreadyPremium, setAlreadyPremium] = useState(false);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(false);

  const checkoutMu = useMutation({
    mutationFn: () => createCheckoutSession(),
    onSuccess: (session) => {
      if (!session.url) {
        setError("Checkout could not be started. Please try again.");
        return;
      }
      redirectToExternalUrl(session.url);
    },
    onError: async (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        await queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
        await refetch();
        setAlreadyPremium(true);
        setEmailVerificationRequired(false);
        setError(ALREADY_PREMIUM_MESSAGE);
        return;
      }
      if (isEmailVerificationRequiredError(err)) {
        setEmailVerificationRequired(true);
        setError(billingActionErrorMessage(err));
        return;
      }
      setEmailVerificationRequired(false);
      setError(billingActionErrorMessage(err));
    },
  });

  return {
    startCheckout: () => {
      setError(null);
      setAlreadyPremium(false);
      setEmailVerificationRequired(false);
      checkoutMu.mutate();
    },
    checkoutBusy: checkoutMu.isPending,
    checkoutError: error,
    alreadyPremium,
    emailVerificationRequired,
  };
}
