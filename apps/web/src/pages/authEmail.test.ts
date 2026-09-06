import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const registerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Register.tsx"),
  "utf8"
);
const loginSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Login.tsx"),
  "utf8"
);
const forgotSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ForgotPassword.tsx"),
  "utf8"
);
const resetSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ResetPassword.tsx"),
  "utf8"
);
const verifySource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "VerifyEmail.tsx"),
  "utf8"
);
const bannerSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/EmailVerificationBanner.tsx"),
  "utf8"
);
const resendSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/ResendVerificationButton.tsx"),
  "utf8"
);
const changeEmailSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/ChangeEmailSection.tsx"),
  "utf8"
);
const planBillingSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/billing/PlanBillingSection.tsx"),
  "utf8"
);
const layoutSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/Layout.tsx"),
  "utf8"
);
const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../App.tsx"),
  "utf8"
);

describe("auth email UX", () => {
  it("requires email on Register and asks the user to check their inbox", () => {
    expect(registerSource).toMatch(/type="email"/);
    expect(registerSource).toMatch(/required/);
    expect(registerSource).not.toMatch(/optional/i);
    expect(registerSource).toMatch(/Check your email to verify your account/);
    expect(registerSource).toMatch(/Continue to app/);
  });

  it("links Login to forgot password", () => {
    expect(loginSource).toMatch(/Forgot password\?/);
    expect(loginSource).toMatch(/\/forgot-password/);
  });

  it("shows a neutral forgot-password confirmation", () => {
    expect(forgotSource).toMatch(
      /If an account exists for that email, we've sent password reset instructions/
    );
    expect(forgotSource).not.toMatch(/No user found/i);
  });

  it("validates reset password confirmation and shows success plus sign-in", () => {
    expect(resetSource).toMatch(/New password/);
    expect(resetSource).toMatch(/Confirm new password/);
    expect(resetSource).toMatch(/Passwords do not match/);
    expect(resetSource).toMatch(/Your password has been reset/);
    expect(resetSource).toMatch(/Sign in/);
    expect(resetSource).toMatch(/setParams\(\{\}, \{ replace: true \}\)/);
  });

  it("covers verify-email success and error states", () => {
    expect(verifySource).toMatch(/Verifying\.\.\./);
    expect(verifySource).toMatch(/Email verified/);
    expect(verifySource).toMatch(/Verification link expired/);
    expect(verifySource).toMatch(/Invalid verification link/);
    expect(verifySource).toMatch(/Continue to app/);
    expect(appSource).toMatch(/path="\/verify-email"/);
    expect(appSource).toMatch(/path="\/reset-password"/);
    expect(appSource).toMatch(/path="\/forgot-password"/);
  });

  it("shows a non-blocking unverified notice with resend", () => {
    expect(bannerSource).toMatch(/Verify your email to protect your account/);
    expect(bannerSource).toMatch(/ResendVerificationButton/);
    expect(resendSource).toMatch(/Resend verification email/);
    expect(layoutSource).toMatch(/EmailVerificationBanner/);
  });

  it("lets Settings change email and prompts blank-email users to add one", () => {
    expect(changeEmailSource).toMatch(/Change email/);
    expect(changeEmailSource).toMatch(/Add email/);
    expect(changeEmailSource).toMatch(/Add an email address to protect and recover your account/);
    expect(changeEmailSource).toMatch(/Email updated. Check your new address to verify it/);
    expect(changeEmailSource).toMatch(/Verified/);
    expect(changeEmailSource).toMatch(/Not verified/);
    expect(changeEmailSource).toMatch(/New email/);
    expect(changeEmailSource).toMatch(/Current password/);
    expect(changeEmailSource).toMatch(/hasEmail && !verified/);
  });

  it("blocks unverified Premium checkout in Settings with resend", () => {
    expect(planBillingSource).toMatch(/EMAIL_VERIFICATION_REQUIRED_MESSAGE/);
    expect(planBillingSource).toMatch(/ResendVerificationButton/);
    expect(planBillingSource).not.toMatch(/No user found/i);
  });
});
