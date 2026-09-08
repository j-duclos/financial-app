import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { APP_NAME } from "@budget-app/shared";
import getConfig, { ANDROID_PACKAGE_NAME, IOS_BUNDLE_IDENTIFIER, IOS_DISPLAY_NAME } from "./app.config";

const dir = dirname(fileURLToPath(import.meta.url));
const configSource = readFileSync(join(dir, "app.config.ts"), "utf8");
const easSource = readFileSync(join(dir, "eas.json"), "utf8");

describe("iOS device prep", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env.EXPO_PUBLIC_APP_ENV = originalEnv.EXPO_PUBLIC_APP_ENV;
    process.env.EXPO_PUBLIC_API_URL = originalEnv.EXPO_PUBLIC_API_URL;
    if (originalEnv.EAS_PROJECT_ID === undefined) {
      delete process.env.EAS_PROJECT_ID;
    } else {
      process.env.EAS_PROJECT_ID = originalEnv.EAS_PROJECT_ID;
    }
  });

  it("uses FlowSight display name and the jduclos bundle id", () => {
    expect(APP_NAME).toBe("FlowSight");
    expect(IOS_DISPLAY_NAME).toBe(APP_NAME);
    expect(IOS_BUNDLE_IDENTIFIER).toBe("com.jduclos.flowsight");
    expect(ANDROID_PACKAGE_NAME).toBe("com.budgetapp.mobile");
    expect(configSource).toMatch(/package: ANDROID_PACKAGE_NAME/);
    expect(configSource).toMatch(/androidPackageName: ANDROID_PACKAGE_NAME/);
    expect(configSource).toMatch(/EXPO_PUBLIC_IOS_APP_STORE_ID/);
    expect(configSource).not.toMatch(/iosAppStoreId: "\d/);
    expect(configSource).toMatch(/name: IOS_DISPLAY_NAME/);
    expect(configSource).toMatch(/CFBundleDisplayName: IOS_DISPLAY_NAME/);
    expect(configSource).toMatch(/bundleIdentifier: IOS_BUNDLE_IDENTIFIER/);
    expect(configSource).toMatch(/expo-notifications/);
  });

  it("does not bake a Mac IP or Android emulator host into Expo extra", () => {
    expect(configSource).not.toMatch(/10\.0\.2\.2/);
    expect(configSource).not.toMatch(/192\.168\./);
    expect(configSource).toMatch(/EXPO_PUBLIC_API_URL/);
  });

  it("keeps ATS local-networking exception development-only", () => {
    expect(configSource).toMatch(/NSAllowsLocalNetworking:\s*true/);
    expect(configSource).toMatch(/appEnv === "development"/);
    expect(configSource).not.toMatch(/NSAllowsArbitraryLoads/);
    expect(configSource).not.toMatch(/NSFaceIDUsageDescription/);
  });

  it("keeps EAS preview and production on HTTPS Render", () => {
    expect(easSource).toMatch(/"EXPO_PUBLIC_APP_ENV": "production"/);
    expect(easSource).toMatch(/"EXPO_PUBLIC_APP_ENV": "staging"/);
    expect(easSource).toMatch(/https:\/\/financial-app-1-tu0l\.onrender\.com/);
    expect(easSource).not.toMatch(/localhost/);
    expect(easSource).not.toMatch(/192\.168\./);
  });

  it("emits local ATS only for development prebuilds", () => {
    process.env.EXPO_PUBLIC_APP_ENV = "development";
    process.env.EXPO_PUBLIC_API_URL = "http://192.168.1.10:8000";
    const dev = getConfig({ config: {} } as never);
    expect(dev.name).toBe("FlowSight");
    expect(dev.ios?.bundleIdentifier).toBe("com.jduclos.flowsight");
    expect(dev.ios?.infoPlist?.CFBundleDisplayName).toBe("FlowSight");
    expect(dev.ios?.infoPlist?.NSAppTransportSecurity).toEqual({
      NSAllowsLocalNetworking: true,
    });
    expect(dev.extra?.apiUrl).toBe("http://192.168.1.10:8000");

    process.env.EXPO_PUBLIC_APP_ENV = "production";
    process.env.EXPO_PUBLIC_API_URL = "https://financial-app-1-tu0l.onrender.com";
    const prod = getConfig({ config: {} } as never);
    expect(prod.ios?.infoPlist?.NSAppTransportSecurity).toBeUndefined();
    expect(prod.ios?.infoPlist?.NSLocalNetworkUsageDescription).toBeUndefined();
    expect(prod.extra?.apiUrl).toBe("https://financial-app-1-tu0l.onrender.com");
    expect(prod.extra?.appEnv).toBe("production");
  });

  it("omits extra.eas.projectId unless EAS_PROJECT_ID is set", () => {
    delete process.env.EAS_PROJECT_ID;
    const none = getConfig({ config: {} } as never);
    expect((none.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId).toBeUndefined();

    process.env.EAS_PROJECT_ID = "  eas-proj-1  ";
    const withId = getConfig({ config: {} } as never);
    expect((withId.extra as { eas?: { projectId?: string } }).eas?.projectId).toBe("eas-proj-1");
  });
});
