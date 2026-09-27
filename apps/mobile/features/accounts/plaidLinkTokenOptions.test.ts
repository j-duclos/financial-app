import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/constants/env", () => ({
  getAndroidPackageName: () => "com.budgetapp.mobile",
  getPlaidRedirectUri: () => "https://flowsight360.com/plaid/oauth-return",
}));

import { plaidLinkTokenCreateOptions } from "./plaidLinkTokenOptions";

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
});
