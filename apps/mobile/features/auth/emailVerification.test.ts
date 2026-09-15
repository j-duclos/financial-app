import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESEND_VERIFICATION_SUCCESS } from "@/features/profile/profileSettings";
import {
  ACCOUNT_CREATED_TITLE,
  EMAIL_STILL_UNVERIFIED_MESSAGE,
  EMAIL_VERIFIED_ALERT_TITLE,
  accountCreatedBody,
  refreshVerificationAlert,
  requestVerificationEmailResend,
  shouldShowEmailVerificationReminder,
  verifyEmailReminderBody,
} from "./emailVerification";

const dir = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(dir, "../dashboard/DashboardScreen.tsx"), "utf8");
const registerSource = readFileSync(join(dir, "../../app/(auth)/register.tsx"), "utf8");
const cardSource = readFileSync(join(dir, "EmailVerificationReminderCard.tsx"), "utf8");
const successSource = readFileSync(join(dir, "RegistrationSuccessPanel.tsx"), "utf8");
const actionsSource = readFileSync(join(dir, "useEmailVerificationActions.ts"), "utf8");

describe("email verification reminder visibility", () => {
  it("shows the card for an unverified user with an email", () => {
    expect(
      shouldShowEmailVerificationReminder({
        email: "new@example.com",
        email_verified: false,
      })
    ).toBe(true);
    expect(verifyEmailReminderBody("new@example.com")).toContain("new@example.com");
  });

  it("hides the card when email is verified", () => {
    expect(
      shouldShowEmailVerificationReminder({
        email: "new@example.com",
        email_verified: true,
      })
    ).toBe(false);
  });

  it("hides the card when there is no email address", () => {
    expect(shouldShowEmailVerificationReminder({ email: "", email_verified: false })).toBe(false);
    expect(shouldShowEmailVerificationReminder({ email: null, email_verified: false })).toBe(false);
    expect(shouldShowEmailVerificationReminder({ email_verified: false })).toBe(false);
    expect(shouldShowEmailVerificationReminder(null)).toBe(false);
  });

  it("removes the reminder after a refreshed profile returns verified", () => {
    const before = { email: "new@example.com", email_verified: false as boolean };
    expect(shouldShowEmailVerificationReminder(before)).toBe(true);
    expect(shouldShowEmailVerificationReminder({ ...before, email_verified: true })).toBe(false);
    expect(refreshVerificationAlert(true)).toEqual({ title: EMAIL_VERIFIED_ALERT_TITLE });
    expect(refreshVerificationAlert(false)).toEqual({ title: EMAIL_STILL_UNVERIFIED_MESSAGE });
  });
});

describe("resend and refresh actions", () => {
  it("resend calls resendVerification and returns the backend detail", async () => {
    const send = vi.fn().mockResolvedValue({ detail: "Verification email sent." });
    await expect(requestVerificationEmailResend(send)).resolves.toBe("Verification email sent.");
    expect(send).toHaveBeenCalledTimes(1);
    expect(actionsSource).toMatch(/resendVerification/);
    expect(actionsSource).toMatch(/requestVerificationEmailResend\(resendVerification\)/);
    expect(actionsSource).toMatch(/Alert\.alert\("Verification email", detail\)/);
    expect(actionsSource).toMatch(/describeApiError/);
    expect(cardSource).toMatch(/void resend\(\)/);
  });

  it("Refresh status refetches the profile query", () => {
    expect(actionsSource).toMatch(/refreshProfile\(\)/);
    expect(actionsSource).toMatch(/refreshVerificationAlert\(profile\?\.email_verified === true\)/);
    expect(cardSource).toMatch(/void refreshStatus\(\)/);
  });

  it("falls back when the backend detail is empty", async () => {
    await expect(
      requestVerificationEmailResend(async () => ({ detail: "  " }))
    ).resolves.toBe(RESEND_VERIFICATION_SUCCESS);
  });
});

describe("Home and registration wiring", () => {
  it("places the verification reminder above Getting started on Home", () => {
    expect(dashboardSource).toMatch(/shouldShowEmailVerificationReminder/);
    expect(dashboardSource).toMatch(/EmailVerificationReminderCard/);
    const firstRun = dashboardSource.slice(dashboardSource.lastIndexOf("if (firstRun)"));
    const firstRunReminder = firstRun.indexOf("{emailVerificationReminder}");
    const firstRunGettingStarted = firstRun.indexOf("{gettingStartedCard}");
    expect(firstRunReminder).toBeGreaterThan(-1);
    expect(firstRunReminder).toBeLessThan(firstRunGettingStarted);

    const established = dashboardSource.slice(dashboardSource.lastIndexOf("ForecastWindowSelect"));
    expect(established.indexOf("{emailVerificationReminder}")).toBeGreaterThan(-1);
    expect(established.indexOf("{emailVerificationReminder}")).toBeLessThan(
      established.indexOf("{gettingStartedCard}")
    );
  });

  it("shows registration success messaging for a newly created account", () => {
    expect(registerSource).toMatch(/RegistrationSuccessPanel/);
    expect(registerSource).toMatch(/setCreatedEmail\(registeredEmail\)/);
    expect(registerSource).toMatch(/POST_LOGIN_HOME_ROUTE/);
    expect(successSource).toMatch(/ACCOUNT_CREATED_TITLE/);
    expect(successSource).toMatch(/accountCreatedBody/);
    expect(successSource).toMatch(/RESEND_EMAIL_LABEL/);
    expect(successSource).toMatch(/CONTINUE_LABEL/);
    expect(ACCOUNT_CREATED_TITLE).toBe("Account created");
    expect(accountCreatedBody("pat@example.com")).toBe(
      "We sent a verification email to pat@example.com. You can start using FlowSight now, but you'll need to verify your email before using Premium billing and certain account actions."
    );
  });
});
