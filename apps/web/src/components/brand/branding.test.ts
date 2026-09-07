import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_NAME } from "@budget-app/shared";
import { getLegalConfig } from "../../lib/legalConfig";

const dir = dirname(fileURLToPath(import.meta.url));
const loginSource = readFileSync(join(dir, "../../pages/Login.tsx"), "utf8");
const registerSource = readFileSync(join(dir, "../../pages/Register.tsx"), "utf8");
const forgotSource = readFileSync(join(dir, "../../pages/ForgotPassword.tsx"), "utf8");
const appSource = readFileSync(join(dir, "../../App.tsx"), "utf8");
const layoutSource = readFileSync(join(dir, "../Layout.tsx"), "utf8");
const welcomeSource = readFileSync(join(dir, "../onboarding/OnboardingWelcomeModal.tsx"), "utf8");
const profileSource = readFileSync(join(dir, "../../pages/Profile.tsx"), "utf8");
const htmlSource = readFileSync(join(dir, "../../../index.html"), "utf8");

describe("FlowSight web branding", () => {
  it("defaults legal product name to FlowSight", () => {
    expect(getLegalConfig().productName).toBe(APP_NAME);
  });

  it("brands auth and bootstrap loading", () => {
    expect(loginSource).toMatch(/BrandLockup/);
    expect(loginSource).not.toMatch(/Budget App/);
    expect(registerSource).toMatch(/BrandLockup/);
    expect(forgotSource).toMatch(/BrandWordmark/);
    expect(appSource).toMatch(/LoadingScreen/);
    expect(appSource).toMatch(/document\.title = APP_NAME/);
  });

  it("keeps a subtle wordmark in the app shell and about settings", () => {
    expect(layoutSource).toMatch(/BrandWordmark/);
    expect(profileSource).toMatch(/settings-about-section/);
    expect(profileSource).toMatch(/BrandLogo/);
  });

  it("shows branding on onboarding welcome", () => {
    expect(welcomeSource).toMatch(/BrandLogo/);
    expect(welcomeSource).toMatch(/APP_VALUE_STATEMENT/);
    expect(welcomeSource).toMatch(/APP_NAME/);
    expect(welcomeSource).not.toMatch(/Financial App/);
  });

  it("sets the browser tab title and manifest name", () => {
    expect(htmlSource).toMatch(/<title>FlowSight<\/title>/);
    expect(htmlSource).toMatch(/application-name" content="FlowSight"/);
  });
});
