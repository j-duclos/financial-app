import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiError } from "@budget-app/api-client";
import {
  NEUTRAL_PASSWORD_RESET_DETAIL,
  RESET_LINK_INVALID_MESSAGE,
  RESET_SUCCESS_MESSAGE,
  describeForgotPasswordError,
  describeResetPasswordError,
  isValidResetEmail,
  parseResetLinkParams,
  resetPasswordClientError,
  sanitizeAuthRecoveryText,
  runForgotPasswordSubmit,
} from "./passwordReset";

const dir = dirname(fileURLToPath(import.meta.url));
const loginSource = readFileSync(join(dir, "../../app/(auth)/login.tsx"), "utf8");
const forgotSource = readFileSync(join(dir, "../../app/(auth)/forgot-password.tsx"), "utf8");
const resetSource = readFileSync(join(dir, "../../app/(auth)/reset-password.tsx"), "utf8");
const layoutSource = readFileSync(join(dir, "../../app/(auth)/_layout.tsx"), "utf8");

describe("mobile password reset", () => {
  it("shows Forgot password on login and registers auth recovery routes", () => {
    expect(loginSource).toMatch(/Forgot password\?/);
    expect(loginSource).toMatch(/\/\(auth\)\/forgot-password/);
    expect(layoutSource).toMatch(/forgot-password/);
    expect(layoutSource).toMatch(/reset-password/);
  });

  it("submits a valid email and shows a generic success message", () => {
    expect(isValidResetEmail("person@example.com")).toBe(true);
    expect(forgotSource).toMatch(/runForgotPasswordSubmit\(forgotPassword/);
    expect(forgotSource).toMatch(/NEUTRAL_PASSWORD_RESET_DETAIL/);
    expect(NEUTRAL_PASSWORD_RESET_DETAIL).toMatch(
      /If an account exists for that email, we've sent password reset instructions/
    );
    expect(forgotSource).not.toMatch(/No user found/i);
    expect(forgotSource).not.toMatch(/We sent a reset email to/);
  });

  it("rejects invalid emails before calling the API", () => {
    expect(isValidResetEmail("")).toBe(false);
    expect(isValidResetEmail("not-an-email")).toBe(false);
    expect(forgotSource).toMatch(/Enter a valid email address/);
  });

  it("surfaces API and rate-limit errors without revealing account existence", () => {
    expect(describeForgotPasswordError(new ApiError(429, "throttled"))).toMatch(/Too many requests/);
    expect(describeForgotPasswordError(new ApiError(400, "Enter a valid email."))).toBe(
      "Enter a valid email address."
    );
    expect(describeForgotPasswordError(new Error("Network request failed"))).toMatch(/Network/);
    expect(forgotSource).toMatch(/runForgotPasswordSubmit/);
  });

  it("completes reset, handles invalid tokens, and returns to login", () => {
    expect(resetSource).toMatch(/resetPassword\(/);
    expect(resetSource).toMatch(/New password/);
    expect(resetSource).toMatch(/Confirm password/);
    expect(resetSource).toMatch(/RESET_SUCCESS_MESSAGE/);
    expect(resetSource).toMatch(/\/\(auth\)\/login/);
    expect(resetSource).toMatch(/RESET_LINK_INVALID_MESSAGE/);
    expect(resetPasswordClientError("secret12", "other")).toBe("Passwords do not match.");
    expect(resetPasswordClientError("short", "short")).toBe("Use at least 8 characters.");
    expect(parseResetLinkParams({ uid: "", token: "abc" })).toBeNull();
    expect(parseResetLinkParams({ uid: "u1", token: "t1" })).toEqual({ uid: "u1", token: "t1" });
    expect(
      describeResetPasswordError(
        new ApiError(400, "This password reset link is invalid or has expired.")
      )
    ).toBe(RESET_LINK_INVALID_MESSAGE);
    expect(RESET_SUCCESS_MESSAGE).toBe("Your password has been reset.");
  });

  it("does not treat a network failure as forgot-password success", async () => {
    const result = await runForgotPasswordSubmit(
      async () => {
        throw new TypeError("Network request failed");
      },
      "person@example.com"
    );
    expect(result.submitted).toBe(false);
    expect(result.error).toMatch(/Network/);
    expect(forgotSource).toMatch(/if \(result\.submitted\)/);
    expect(forgotSource).not.toMatch(/setSubmitted\(true\);\s*\} catch/s);
  });

  it("never logs reset tokens, JWTs, or passwords", () => {
    expect(forgotSource).toMatch(/runForgotPasswordSubmit/);
    const combined = `${forgotSource}\n${resetSource}`;
    expect(combined).not.toMatch(/console\.(log|info|debug|warn).*token/);
    expect(combined).not.toMatch(/console\.(log|info|debug|warn).*password/);
    expect(combined).not.toMatch(/console\.(log|info|debug|warn).*uid/);
    expect(combined).not.toMatch(/console\.(log|info|debug|warn).*email/);
    const dirty =
      "https://flowsight360.com/reset-password?uid=abc&token=secret Authorization: Bearer eyJhbGciOi.aaa.bbb";
    const clean = sanitizeAuthRecoveryText(dirty);
    expect(clean).not.toContain("secret");
    expect(clean).not.toContain("eyJhbGciOi");
    expect(clean).toContain("uid=[redacted]");
    expect(clean).toContain("token=[redacted]");
  });
});
