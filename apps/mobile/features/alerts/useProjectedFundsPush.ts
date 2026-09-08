import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { registerPushDevice } from "@budget-app/api-client";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useAuth } from "@/features/auth";
import { useProfile } from "@/lib/profileQuery";
import {
  NOTIFICATION_ASKED_STORAGE_KEY,
  PUSH_TOKEN_STORAGE_KEY,
  actionCenterHrefFromPushData,
  isExpoGoRuntime,
  pushPlatformFromOs,
  resolveExpoPushProjectId,
  shouldShowPermissionEducation,
} from "./projectedFundsPush";

type NotificationsModule = typeof import("expo-notifications");

function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === "web") return null;
  if (
    isExpoGoRuntime({
      appOwnership: Constants.appOwnership,
      executionEnvironment: Constants.executionEnvironment,
    })
  ) {
    return null;
  }
  // Lazy require so Expo Go never evaluates expo-notifications (SDK 53 Android redbox).
  return require("expo-notifications") as NotificationsModule;
}

const Notifications = loadNotifications();

Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function registerCurrentToken(): Promise<string | null> {
  if (!Notifications) return null;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return null;
    const projectId = resolveExpoPushProjectId({
      easConfigProjectId: Constants.easConfig?.projectId,
      extraEasProjectId: (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId,
    });
    if (!projectId) {
      if (__DEV__) {
        console.warn("[push] Skipping Expo push token: no EAS projectId (set EAS_PROJECT_ID).");
      }
      return null;
    }
    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResult.data;
    await registerPushDevice({
      expo_push_token: token,
      platform: pushPlatformFromOs(Platform.OS),
    });
    await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    return token;
  } catch (error) {
    if (__DEV__) {
      console.warn("[push] Expo token registration failed", error);
    }
    return null;
  }
}

export function useProjectedFundsPush() {
  const { auth } = useAuth();
  const { data: profile } = useProfile();
  const { status: onboarding } = useOnboardingStatus();
  const router = useRouter();
  const [askVisible, setAskVisible] = useState(false);
  const [alreadyAsked, setAlreadyAsked] = useState(true);
  const listening = useRef(false);
  const nativePushAvailable = Notifications != null;

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
        nativePushAvailable,
      })
    );
  }, [alreadyAsked, auth.isAuthenticated, nativePushAvailable, onboarding, profile]);

  useEffect(() => {
    if (!nativePushAvailable) return;
    if (!auth.isAuthenticated) return;
    if (profile?.projected_funds_push_enabled === false) return;
    void registerCurrentToken();
  }, [auth.isAuthenticated, nativePushAvailable, profile?.projected_funds_push_enabled]);

  useEffect(() => {
    if (!Notifications || listening.current) return;
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
    if (!Notifications) return;
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
