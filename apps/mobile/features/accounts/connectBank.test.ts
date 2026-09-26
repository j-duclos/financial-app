import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const hook = readFileSync(join(dir, "useConnectBank.ts"), "utf8");
const native = readFileSync(join(dir, "openNativePlaidLink.ts"), "utf8");

describe("native Plaid connect on mobile", () => {
  it("reuses backend link-token, exchange, and sync APIs", () => {
    expect(hook).toMatch(/canUsePlaidBankSync\(billing\)/);
    expect(hook).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.bankSync\)/);
    expect(hook).toMatch(/createPlaidLinkToken\(/);
    expect(hook).toMatch(/householdId/);
    expect(hook).not.toMatch(/getMobilePlaidRedirectUri/);
    expect(hook).toMatch(/android_package_name: getAndroidPackageName\(\)/);
    expect(hook).toMatch(/Platform\.OS === "android"/);
    expect(hook).toMatch(/exchangePlaidPublicToken/);
    expect(hook).toMatch(/syncAllPlaidItems\(\{ household: householdId, force: true \}\)/);
    expect(hook).toMatch(/refreshAfterPlaidSync\(queryClient\)/);
    expect(hook).not.toMatch(/from "\.\.\/\.\.\/\.\.\/app\.config"/);
  });

  it("opens native Link via a dynamic SDK import", () => {
    expect(native).toMatch(/createPlaidLinkSession/);
    expect(native).toMatch(/session\.open\(\)/);
    expect(native).toMatch(/onEvent:/);
    expect(native).toMatch(/import\("react-native-plaid-link-sdk"\)/);
    expect(native).toMatch(/PlaidLinkUnavailableError/);
    expect(native).toMatch(/Expo Go cannot open Plaid/);
  });
});
