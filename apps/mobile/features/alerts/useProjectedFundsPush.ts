import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { registerPushDevice } from "@budget-app/api-client";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/lib/profileQuery";
import {
  NOTIFICATION_ASKED_STORAGE_KEY,
  PUSH_TOKEN_STORAGE_KEY,
  actionCenterHrefFromPushData,
  pushPlatformFromOs,
  shouldShowPermissionEducation,
} from "./projectedFundsPush";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function registerCurrentToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return null;
  const projectId =
    Constants.easConfig?.projectId ||
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const tokenResult = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );
  const token = tokenResult.data;
  await registerPushDevice({
    expo_push_token: token,
    platform: pushPlatformFromOs(Platform.OS),
  });
  await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
  return token;
}

export function useProjectedFundsPush() {
  const { auth } = useAuth();
  const { data: profile } = useProfile();
  const { status: onboarding } = useOnboardingStatus();
  const router = useRouter();
  const [askVisible, setAskVisible] = useState(false);
  const [alreadyAsked, setAlreadyAsked] = useState(true);
  const listening = useRef(false);

  useEffect(() => {
    void AsyncStorage.getItem(NOTIFICATION_ASKED_STORAGE_KEY).then((value) => {
      setAlreadyAsked(value === "1");
    });
  }, [auth.isAuthenticated]);

  useEffect(() => {
    const hasFinancialData = Boolean(onboarding?.steps.forecast_ready || onboarding?.completed);
    const pushPref = profile?.projected_funds_push_enabled !== false && profile?.projected_funds_alerts_enabled !== false;
    setAskVisible(
      shouldShowPermissionEducation({
        authenticated: auth.isAuthenticated,
        hasFinancialData,
        alreadyAsked,
        pushPrefEnabled: pushPref,
      })
    );
  }, [alreadyAsked, auth.isAuthenticated, onboarding, profile]);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    if (profile?.projected_funds_push_enabled === false) return;
    void registerCurrentToken();
  }, [auth.isAuthenticated, profile?.projected_funds_push_enabled]);

  useEffect(() => {
    if (listening.current) return;
    listening.current = true;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        alertId?: number;
        url?: string;
      };
      router.push(actionCenterHrefFromPushData(data));
    });
    return () => {
      sub.remove();
      listening.current = false;
    };
  }, [router]);

  const markAsked = useCallback(async () => {
    await AsyncStorage.setItem(NOTIFICATION_ASKED_STORAGE_KEY, "1");
    setAlreadyAsked(true);
    setAskVisible(false);
  }, []);

  const enable = useCallback(async () => {
    await markAsked();
    if (Platform.OS === "web") return;
    const perm = await Notifications.requestPermissionsAsync();
    if (perm.status !== "granted") return;
    await registerCurrentToken();
  }, [markAsked]);

  return {
    askVisible,
    enable,
    dismiss: markAsked,
  };
}
