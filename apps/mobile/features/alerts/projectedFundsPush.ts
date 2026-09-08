import type { ProjectedFundsAlert } from "@budget-app/shared";
import {
  parseProjectedFundsAlertId,
  projectedFundsActionCenterPath,
  shouldPromptNotificationPermission,
} from "@budget-app/shared";

export const NOTIFICATION_ASKED_STORAGE_KEY = "flowsight.notificationPermissionAsked";
export const PUSH_TOKEN_STORAGE_KEY = "flowsight.expoPushToken";

export function actionCenterHrefFromPushData(data: {
  alertId?: number | string | null;
  url?: string | null;
} | null | undefined): "/(app)/action-center" | `/(app)/action-center?alert=${string}` {
  const fromUrl =
    typeof data?.url === "string" ? parseProjectedFundsAlertId(new URLSearchParams(data.url.split("?")[1] || "")) : null;
  const rawId = data?.alertId ?? fromUrl;
  const id = rawId == null ? null : Number(rawId);
  if (id && Number.isFinite(id) && id > 0) {
    return `/(app)/action-center?alert=${id}`;
  }
  return "/(app)/action-center";
}

export function pushPlatformFromOs(os: string | undefined): "ios" | "android" | "web" | "unknown" {
  if (os === "ios") return "ios";
  if (os === "android") return "android";
  if (os === "web") return "web";
  return "unknown";
}

/** Expo push tokens need an EAS project id. Bare `expo run:*` builds have none unless EAS_PROJECT_ID is set. */
export function resolveExpoPushProjectId(input: {
  easConfigProjectId?: string | null;
  extraEasProjectId?: string | null;
}): string | null {
  for (const value of [input.easConfigProjectId, input.extraEasProjectId]) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) return trimmed;
  }
  return null;
}

/** SDK 53+ Expo Go cannot register Android remote push; loading expo-notifications redboxes. */
export function isExpoGoRuntime(input: {
  appOwnership?: string | null;
  executionEnvironment?: string | null;
}): boolean {
  return input.appOwnership === "expo" || input.executionEnvironment === "storeClient";
}

export function shouldShowPermissionEducation(input: {
  authenticated: boolean;
  hasFinancialData: boolean;
  alreadyAsked: boolean;
  pushPrefEnabled: boolean;
  nativePushAvailable?: boolean;
}): boolean {
  if (!input.authenticated) return false;
  if (input.nativePushAvailable === false) return false;
  return shouldPromptNotificationPermission({
    hasFinancialData: input.hasFinancialData,
    alreadyAsked: input.alreadyAsked,
    pushPrefEnabled: input.pushPrefEnabled,
  });
}

export function ledgerFocusFromAlert(alert: Pick<ProjectedFundsAlert, "account" | "occurrence_date" | "transaction">) {
  return {
    accountId: alert.account,
    focusDate: alert.occurrence_date,
    focusTransactionId: alert.transaction,
  };
}

export { projectedFundsActionCenterPath };
