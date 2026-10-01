import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const hook = readFileSync(join(dir, "useConnectBank.ts"), "utf8");
const native = readFileSync(join(dir, "openNativePlaidLink.ts"), "utf8");
const options = readFileSync(join(dir, "plaidLinkTokenOptions.ts"), "utf8");
const config = readFileSync(join(dir, "../../app.config.ts"), "utf8");

describe("native Plaid connect on mobile", () => {
  it("reuses backend link-token, exchange, and sync APIs", () => {
    expect(hook).toMatch(/canUsePlaidBankSync\(billing\)/);
    expect(hook).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.bankSync\)/);
    expect(hook).toMatch(/createPlaidLinkToken\(/);
    expect(hook).toMatch(/plaidLinkTokenCreateAttempts\(Platform\.OS\)/);
    expect(hook).toMatch(/isPlaidRedirectUriRejected/);
    expect(hook).toMatch(/exchangePlaidPublicToken/);
    expect(hook).toMatch(/runHouseholdPlaidSync\(\{/);
    expect(hook).toMatch(/force: true/);
    expect(hook).toMatch(/Bank connected, import incomplete/);
    expect(hook).toMatch(/PlaidLinkExitError/);
    expect(hook).not.toMatch(/from "\.\.\/\.\.\/\.\.\/app\.config"/);
  });

  it("sends iOS redirect_uri and Android package name as mutually exclusive options", () => {
    expect(options).toMatch(/getPlaidRedirectUri\(\)/);
    expect(options).toMatch(/redirect_uri: getPlaidRedirectUri\(\)/);
    expect(options).toMatch(/plaidLinkTokenCreateAttempts/);
    expect(options).toMatch(/undefined/);
    expect(options).toMatch(/android_package_name: getAndroidPackageName\(\)/);
    expect(options).toMatch(/platform === "android"/);
    expect(options).toMatch(/platform === "ios"/);
  });

  it("opens native Link via a dynamic SDK import", () => {
    expect(native).toMatch(/createPlaidLinkSession/);
    expect(native).toMatch(/session\.open\(true\)/);
    expect(native).toMatch(/onEvent:/);
    expect(native).toMatch(/PlaidLinkExitError/);
    expect(native).toMatch(/requireOptionalNativeModule\("ReactNativePlaidLinkSdk"\)/);
    expect(native).toMatch(/import\("react-native-plaid-link-sdk"\)/);
    expect(native).toMatch(/PlaidLinkUnavailableError/);
    expect(native).toMatch(/npx expo run:ios --device/);
  });

  it("keeps the native OAuth return screen mounted for Universal Links", () => {
    expect(config).toMatch(/APPLE_PAID_IOS_CAPABILITIES/);
    const oauthReturn = readFileSync(join(dir, "../../app/plaid/oauth-return.tsx"), "utf8");
    expect(oauthReturn).toMatch(/Finishing bank sign-in/);
    expect(oauthReturn).not.toMatch(/from "expo-router"/);
  });
});
