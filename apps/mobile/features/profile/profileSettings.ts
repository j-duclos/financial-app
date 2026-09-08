import type { QueryClient } from "@tanstack/react-query";
import type { DeleteAccountPreflight, UserProfile } from "@budget-app/api-client";
import {
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  forecastPickerRows,
  type BillingStatus,
  type OperationalForecastDays,
} from "@budget-app/shared";
import { PROFILE_QUERY_KEY } from "@/lib/profileQueryKey";
import { BILLING_STATUS_QUERY_KEY } from "@/lib/billing";

/** Forecast-window changes affect operational views — not historical reports. */
export const FORECAST_PREFERENCE_QUERY_PREFIXES = [
  ["dashboard-summary"],
  ["dashboard-summary-fast"],
  ["dashboard-summary-details"],
  ["extended-cash-risk"],
  ["recommendations"],
  ["transactions"],
  ["timeline"],
  ["calendar-summary"],
  ["calendar-chunk"],
  ["accounts"],
  ["account"],
  ["debt-plan"],
] as const;

export const DELETE_CONFIRMATION = "DELETE";
export const EMAIL_CHANGE_SUCCESS = "Check your new email to verify your address.";
export const PASSWORD_CHANGE_SUCCESS = "Password updated.";
export const RESEND_VERIFICATION_SUCCESS = "Verification email sent.";
export const MIN_PASSWORD_LENGTH = 8;

export const DELETE_ACCOUNT_CONSEQUENCES = [
  "Personal account data will be removed.",
  "Exclusively owned financial data may be removed.",
  "Shared household data may remain for other members.",
  "An active subscription will be canceled.",
  "Linked-bank access belonging exclusively to deleted data will be revoked.",
] as const;

export function forecastWindowOptions(): {
  value: OperationalForecastDays;
  label: string;
}[] {
  return OPERATIONAL_FORECAST_DAY_OPTIONS.map((value) => ({
    value,
    label: FORECAST_WINDOW_LABELS[value],
  }));
}

export function forecastWindowPickerOptions(billing: BillingStatus | undefined | null): {
  value: OperationalForecastDays;
  label: string;
  locked: boolean;
}[] {
  return forecastPickerRows(billing).map((row) => ({
    value: row.days,
    label: row.label,
    locked: row.locked,
  }));
}

export function applyUpdatedProfileCache(queryClient: QueryClient, profile: UserProfile): void {
  queryClient.setQueryData(PROFILE_QUERY_KEY, profile);
}

export function invalidateAfterForecastWindowChange(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
  for (const queryKey of FORECAST_PREFERENCE_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

/** Immediate entitlement refresh after a development plan simulation change. */
export const PLAN_TEST_OVERRIDE_QUERY_PREFIXES = [
  BILLING_STATUS_QUERY_KEY,
  PROFILE_QUERY_KEY,
  ["dashboard-summary"],
  ["dashboard-summary-fast"],
  ["dashboard-summary-details"],
  ["extended-cash-risk"],
  ["transactions"],
  ["timeline"],
  ["calendar-summary"],
  ["calendar-chunk"],
  ["accounts"],
  ["account"],
  ["rules"],
  ["bills-overview"],
  ["buckets"],
  ["bucket-detail"],
  ["goals-report"],
  ["monthly-reports"],
  ["debt-plan"],
  ["account-payoff"],
  ["recommendations"],
  ["onboarding"],
] as const;

export function invalidateAfterTestPlanChange(queryClient: QueryClient): void {
  for (const queryKey of PLAN_TEST_OVERRIDE_QUERY_PREFIXES) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}

/** True when About legal/support rows can be shown. */
export function hasConfiguredLegalLinks(opts: {
  privacyUrl: string | null;
  termsUrl: string | null;
  supportEmail: string | null;
}): boolean {
  return Boolean(opts.privacyUrl || opts.termsUrl || opts.supportEmail);
}

/** Dev-only environment line for Settings → Development. */
export function developmentEnvironmentLabel(opts: {
  appEnv: string;
  apiTarget: string;
}): string {
  const env =
    opts.appEnv === "development"
      ? "Development"
      : opts.appEnv === "staging"
        ? "Staging"
        : opts.appEnv === "production"
          ? "Production"
          : opts.appEnv;
  return `${env} · ${opts.apiTarget} API`;
}

export function hasProfileEmail(email?: string | null): boolean {
  return Boolean(email?.trim());
}

export function profileEmailDisplay(email?: string | null): string {
  const trimmed = email?.trim() ?? "";
  return trimmed || "No email address";
}

export function emailVerificationLabel(verified?: boolean): "Verified" | "Not verified" {
  return verified ? "Verified" : "Not verified";
}

export function emailSettingsRow(opts: { email?: string | null; verified?: boolean }): {
  title: string;
  value: string;
  subtitle?: string;
} {
  if (!hasProfileEmail(opts.email)) {
    return { title: "Email", value: "Add email" };
  }
  return {
    title: "Email",
    value: emailVerificationLabel(opts.verified),
    subtitle: opts.email!.trim(),
  };
}

export function shouldShowResendVerification(opts: {
  email?: string | null;
  verified?: boolean;
}): boolean {
  return hasProfileEmail(opts.email) && opts.verified !== true;
}

export type PasswordFieldErrors = {
  current?: string;
  next?: string;
  confirm?: string;
};

export function clientPasswordErrors(opts: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): PasswordFieldErrors | null {
  const errors: PasswordFieldErrors = {};
  if (!opts.currentPassword) {
    errors.current = "Enter your current password.";
  }
  if (!opts.newPassword) {
    errors.next = "Enter a new password.";
  } else if (opts.newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.next = `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!opts.confirmPassword) {
    errors.confirm = "Confirm the new password.";
  } else if (opts.newPassword && opts.newPassword !== opts.confirmPassword) {
    errors.confirm = "New password and confirmation do not match.";
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export function passwordApiFieldErrors(message: string): PasswordFieldErrors {
  const errors: PasswordFieldErrors = {};
  const lower = message.toLowerCase();
  if (lower.includes("current_password") || lower.includes("current password")) {
    errors.current = message.replace(/^current_password:\s*/i, "");
  }
  if (lower.includes("new_password_confirm") || lower.includes("do not match")) {
    errors.confirm = message.replace(/^new_password_confirm:\s*/i, "");
  }
  if (lower.includes("new_password") && !lower.includes("new_password_confirm")) {
    errors.next = message.replace(/^new_password:\s*/i, "");
  }
  return errors;
}

export function deleteAccountBlockingCopy(preflight: DeleteAccountPreflight): string[] {
  return preflight.blocking_reasons.map((reason) => {
    if (reason.code === "household_owner_transfer_required") {
      const name = reason.household_name?.trim() || "this household";
      return `You are the only owner of ${name}. Transfer ownership before deleting your account.`;
    }
    if (reason.detail?.trim()) return reason.detail;
    if (reason.code === "email_verification_required") {
      return "Verify your email before deleting your account.";
    }
    return "Account deletion is blocked. Resolve the issue and try again.";
  });
}

export function clientDeleteAccountError(opts: {
  currentPassword: string;
  confirmation: string;
}): string | null {
  if (!opts.currentPassword) return "Enter your current password.";
  if (opts.confirmation.trim() !== DELETE_CONFIRMATION) {
    return "Type DELETE to confirm account deletion.";
  }
  return null;
}

export function profileExportFallbackName(today: string): string {
  return `financial-app-data-${today}.json`;
}

export function transactionsCsvFallbackName(today: string): string {
  return `financial-app-transactions-${today}.csv`;
}
