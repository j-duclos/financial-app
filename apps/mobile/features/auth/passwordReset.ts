import { ApiError } from "@budget-app/api-client";
import { describeApiError } from "@/services/apiErrors";

export const NEUTRAL_PASSWORD_RESET_DETAIL =
  "If an account exists for that email, we've sent password reset instructions.";

export const RESET_LINK_INVALID_MESSAGE =
  "This reset link is invalid or has expired. Request a new one from Forgot password.";

export const RESET_SUCCESS_MESSAGE = "Your password has been reset.";

export const RESET_EMAIL_NEXT_STEP =
  "Open the reset link in your email, choose a new password, then return here to sign in.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeResetEmail(email: string): string {
  return email.trim();
}

export function isValidResetEmail(email: string): boolean {
  return EMAIL_RE.test(normalizeResetEmail(email));
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

export function parseResetLinkParams(params: {
  uid?: string | string[];
  token?: string | string[];
}): { uid: string; token: string } | null {
  const uid = firstParam(params.uid);
  const token = firstParam(params.token);
  if (!uid || !token) return null;
  return { uid, token };
}

export function resetPasswordClientError(password: string, confirm: string): string {
  if (!password || !confirm) return "Enter and confirm your new password.";
  if (password !== confirm) return "Passwords do not match.";
  if (password.length < 8) return "Use at least 8 characters.";
  return "";
}

export function describeForgotPasswordError(err: unknown): string {
  if (err instanceof ApiError && err.status === 400) {
    return "Enter a valid email address.";
  }
  return describeApiError(err);
}

export function describeResetPasswordError(err: unknown): string {
  if (err instanceof ApiError && err.status === 400) {
    if (/invalid or has expired/i.test(err.message)) {
      return RESET_LINK_INVALID_MESSAGE;
    }
    return err.message || "Could not reset password.";
  }
  return describeApiError(err);
}

/** Never log tokens, JWTs, or passwords. */
export function sanitizeAuthRecoveryText(text: string): string {
  return text
    .replace(/[?&](uid|token)=[^&\s]+/gi, (_, key: string) => `${key}=[redacted]`)
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
}
