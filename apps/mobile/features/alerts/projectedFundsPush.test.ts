import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldPromptNotificationPermission } from "@budget-app/shared";
import {
  actionCenterHrefFromPushData,
  shouldShowPermissionEducation,
} from "./projectedFundsPush";

const dir = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(dir, "useProjectedFundsPush.ts"), "utf8");
const sheetSource = readFileSync(join(dir, "NotificationPermissionSheet.tsx"), "utf8");
const alertsSource = readFileSync(join(dir, "ProjectedFundsAlerts.tsx"), "utf8");
const settingsSource = readFileSync(join(dir, "../profile/ProfileSettingsScreen.tsx"), "utf8");
const authSource = readFileSync(join(dir, "../auth/AuthContext.tsx"), "utf8");
const layoutSource = readFileSync(join(dir, "../../app/(app)/_layout.tsx"), "utf8");
const actionCenterSource = readFileSync(join(dir, "../action-center/ActionCenterScreen.tsx"), "utf8");

describe("mobile projected funds push", () => {
  it("does not request permission on first launch without context", () => {
    expect(
      shouldShowPermissionEducation({
        authenticated: true,
        hasFinancialData: false,
        alreadyAsked: false,
        pushPrefEnabled: true,
      })
    ).toBe(false);
    expect(shouldPromptNotificationPermission({ hasFinancialData: false, alreadyAsked: false, pushPrefEnabled: true })).toBe(
      false
    );
    expect(hookSource).toMatch(/forecast_ready/);
    expect(hookSource).toMatch(/requestPermissionsAsync/);
    expect(sheetSource).toMatch(/NOTIFICATION_PERMISSION_COPY\.title/);
    expect(sheetSource).toMatch(/NOTIFICATION_PERMISSION_COPY\.enable/);
  });

  it("registers Expo tokens with the backend and unregisters on logout", () => {
    expect(hookSource).toMatch(/registerPushDevice/);
    expect(hookSource).toMatch(/getExpoPushTokenAsync/);
    expect(authSource).toMatch(/unregisterStoredPushToken/);
  });

  it("opens Action Center from the push payload", () => {
    expect(actionCenterHrefFromPushData({ alertId: 9 })).toBe("/(app)/action-center?alert=9");
    expect(actionCenterHrefFromPushData({ url: "/action-center?alert=9" })).toBe(
      "/(app)/action-center?alert=9"
    );
    expect(hookSource).toMatch(/addNotificationResponseReceivedListener/);
    expect(actionCenterSource).toMatch(/ProjectedFundsActionCards/);
    expect(actionCenterSource).not.toMatch(/projected_balance_before\s*</);
  });

  it("shows in-app alerts from the server and settings toggles", () => {
    expect(alertsSource).toMatch(/listProjectedFundsAlerts/);
    expect(alertsSource).not.toMatch(/build_forecast/);
    expect(settingsSource).toMatch(/projected_funds_alerts_enabled/);
    expect(settingsSource).toMatch(/projected_funds_push_enabled/);
    expect(layoutSource).toMatch(/ProjectedFundsInAppBanner/);
    expect(layoutSource).toMatch(/NotificationPermissionSheet/);
  });
});
