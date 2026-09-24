/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  inviteLoginPath,
  inviteRegisterPath,
  persistPremiumInviteToken,
  readPremiumInviteToken,
  clearPremiumInviteToken,
  PREMIUM_INVITE_STORAGE_KEY,
} from "./premiumInvite";

describe("premium invite storage", () => {
  it("persists and clears the token without using sequential ids", () => {
    persistPremiumInviteToken("  abcToken  ");
    expect(readPremiumInviteToken()).toBe("abcToken");
    expect(sessionStorage.getItem(PREMIUM_INVITE_STORAGE_KEY)).toBe("abcToken");
    expect(inviteRegisterPath("abcToken", "beta@example.com")).toBe(
      "/register?invite=abcToken&email=beta%40example.com"
    );
    expect(inviteLoginPath("abcToken")).toBe("/login?invite=abcToken");
    clearPremiumInviteToken();
    expect(readPremiumInviteToken()).toBeNull();
  });
});
