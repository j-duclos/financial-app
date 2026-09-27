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
    expect(hook).toMatch(/plaidLinkTokenCreateOptions\(Platform\.OS\)/);
    expect(hook).toMatch(/exchangePlaidPublicToken/);
    expect(hook).toMatch(/syncAllPlaidItems\(\{ household: householdId, force: true \}\)/);
    expect(hook).toMatch(/refreshAfterPlaidSync\(queryClient\)/);
    expect(hook).toMatch(/PlaidLinkExitError/);
    expect(hook).not.toMatch(/from "\.\.\/\.\.\/\.\.\/app\.config"/);
  });

  it("sends iOS redirect_uri and Android package name as mutually exclusive options", () => {
    expect(options).toMatch(/getPlaidRedirectUri\(\)/);
    expect(options).toMatch(/redirect_uri: getPlaidRedirectUri\(\)/);
    expect(options).toMatch(/android_package_name: getAndroidPackageName\(\)/);
    expect(options).toMatch(/platform === "android"/);
    expect(options).toMatch(/platform === "ios"/);
  });

  it("opens native Link via a dynamic SDK import", () => {
    expect(native).toMatch(/createPlaidLinkSession/);
    expect(native).toMatch(/session\.open\(\)/);
    expect(native).toMatch(/onEvent:/);
    expect(native).toMatch(/PlaidLinkExitError/);
    expect(native).toMatch(/requireOptionalNativeModule\("ReactNativePlaidLinkSdk"\)/);
    expect(native).toMatch(/import\("react-native-plaid-link-sdk"\)/);
    expect(native).toMatch(/PlaidLinkUnavailableError/);
    expect(native).toMatch(/npx expo run:ios --device/);
  });

  it("does not reintroduce associatedDomains for Plaid OAuth", () => {
    expect(config).not.toMatch(/associatedDomains/);
  });
});
