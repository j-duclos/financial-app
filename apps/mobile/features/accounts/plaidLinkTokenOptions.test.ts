import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/constants/env", () => ({
  getAndroidPackageName: () => "com.budgetapp.mobile",
  getPlaidRedirectUri: () => "https://flowsight360.com/plaid/oauth-return",
}));

import {
  isPlaidRedirectUriRejected,
  plaidLinkTokenCreateAttempts,
  plaidLinkTokenCreateOptions,
  plaidRedirectUriHostVariants,
} from "./plaidLinkTokenOptions";

describe("plaidLinkTokenCreateOptions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends redirect_uri on iOS and not android_package_name", () => {
    expect(plaidLinkTokenCreateOptions("ios")).toEqual({
      redirect_uri: "https://flowsight360.com/plaid/oauth-return",
    });
  });

  it("sends android_package_name on Android and not redirect_uri", () => {
    expect(plaidLinkTokenCreateOptions("android")).toEqual({
      android_package_name: "com.budgetapp.mobile",
    });
  });

  it("sends no Plaid options on other platforms", () => {
    expect(plaidLinkTokenCreateOptions("web")).toBeUndefined();
  });

  it("retries iOS www host then omits redirect_uri for the server default", () => {
    expect(plaidRedirectUriHostVariants("https://flowsight360.com/plaid/oauth-return")).toEqual([
      "https://flowsight360.com/plaid/oauth-return",
      "https://www.flowsight360.com/plaid/oauth-return",
    ]);
    expect(plaidLinkTokenCreateAttempts("ios")).toEqual([
      { redirect_uri: "https://flowsight360.com/plaid/oauth-return" },
      { redirect_uri: "https://www.flowsight360.com/plaid/oauth-return" },
      undefined,
    ]);
    expect(plaidLinkTokenCreateAttempts("android")).toEqual([
      { android_package_name: "com.budgetapp.mobile" },
    ]);
    expect(isPlaidRedirectUriRejected(new Error("Plaid rejected redirect_uri: … dashboard"))).toBe(
      true
    );
    expect(isPlaidRedirectUriRejected(new Error("INVALID_API_KEYS"))).toBe(false);
  });
});
