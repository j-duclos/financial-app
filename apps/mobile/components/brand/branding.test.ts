import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_NAME, APP_TAGLINE } from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const loginSource = readFileSync(join(dir, "../../app/(auth)/login.tsx"), "utf8");
const registerSource = readFileSync(join(dir, "../../app/(auth)/register.tsx"), "utf8");
const indexSource = readFileSync(join(dir, "../../app/index.tsx"), "utf8");
const appLayoutSource = readFileSync(join(dir, "../../app/(app)/_layout.tsx"), "utf8");
const overlaySource = readFileSync(join(dir, "../PrivacyOverlay.tsx"), "utf8");
const profileSource = readFileSync(join(dir, "../../features/profile/ProfileSettingsScreen.tsx"), "utf8");
const firstRunSource = readFileSync(join(dir, "../../features/dashboard/DashboardFirstRun.tsx"), "utf8");
const configSource = readFileSync(join(dir, "../../app.config.ts"), "utf8");

describe("FlowSight mobile branding", () => {
  it("uses a branded loading screen during bootstrap", () => {
    expect(indexSource).toMatch(/LoadingScreen/);
    expect(appLayoutSource).toMatch(/LoadingScreen/);
    expect(indexSource).not.toMatch(/ActivityIndicator/);
  });

  it("shows the logo and tagline on auth screens", () => {
    expect(loginSource).toMatch(/BrandLogo/);
    expect(loginSource).toMatch(/APP_TAGLINE/);
    expect(loginSource).not.toMatch(/>\s*Budget\s*</);
    expect(registerSource).toMatch(/BrandLogo/);
    expect(registerSource).toMatch(/APP_TAGLINE/);
  });

  it("keeps privacy overlay and settings about on the product name", () => {
    expect(overlaySource).toMatch(/BrandWordmark/);
    expect(profileSource).toMatch(/BrandLogo/);
    expect(profileSource).toMatch(/APP_NAME/);
    expect(profileSource).toMatch(/SectionHeader title="About"/);
  });

  it("adds branding to first-run without replacing setup actions", () => {
    expect(firstRunSource).toMatch(/BrandLogo/);
    expect(firstRunSource).toMatch(/APP_VALUE_STATEMENT/);
    expect(firstRunSource).toMatch(/Add account manually/);
    expect(firstRunSource).toMatch(/APP_WEB_COMPANION_MESSAGE/);
    expect(firstRunSource).toMatch(/Open FlowSight on the web/);
  });

  it("sets the native display name from shared branding", () => {
    expect(configSource).toMatch(/IOS_DISPLAY_NAME = "FlowSight"/);
    expect(configSource).toMatch(/CFBundleDisplayName: IOS_DISPLAY_NAME/);
    expect(configSource).toMatch(/flowsight-logo\.jpg/);
    expect(APP_NAME).toBe("FlowSight");
    expect(APP_TAGLINE.length).toBeGreaterThan(0);
  });
});
