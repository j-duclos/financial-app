import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { resendVerification } from "@budget-app/api-client";
import { describeApiError } from "@/services/api";
import { useAuth } from "./AuthContext";
import {
  refreshVerificationAlert,
  requestVerificationEmailResend,
} from "./emailVerification";

export function useEmailVerificationActions() {
  const { refreshProfile } = useAuth();
  const [resending, setResending] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const pending = resending || refreshingStatus;

  const resend = useCallback(async () => {
    if (pending) return;
    setResending(true);
    try {
      const detail = await requestVerificationEmailResend(resendVerification);
      Alert.alert("Verification email", detail);
    } catch (err) {
      Alert.alert("Couldn’t send email", describeApiError(err));
    } finally {
      setResending(false);
    }
  }, [pending]);

  const refreshStatus = useCallback(async () => {
    if (pending) return;
    setRefreshingStatus(true);
    try {
      const profile = await refreshProfile();
      const alert = refreshVerificationAlert(profile?.email_verified === true);
      Alert.alert(alert.title, alert.message);
    } finally {
      setRefreshingStatus(false);
    }
  }, [pending, refreshProfile]);

  return { resend, refreshStatus, resending, refreshingStatus, pending };
}
