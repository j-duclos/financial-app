import { ApiError } from "./config";

/** Authenticated Free user denied a Premium-only feature. Not every 403. */
export function isPremiumRequiredError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "premium_required";
}

/** Free-plan quota exceeded. Distinct from Premium-required and from auth. */
export function isPlanLimitReachedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "plan_limit_reached";
}

/** Terminal or recoverable auth failure. Distinct from entitlement 403s. */
export function isAuthFailureError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401;
}

export function classifyApiAccessError(
  error: unknown
): "auth" | "premium_required" | "plan_limit_reached" | "other" {
  if (isAuthFailureError(error)) return "auth";
  if (isPremiumRequiredError(error)) return "premium_required";
  if (isPlanLimitReachedError(error)) return "plan_limit_reached";
  return "other";
}
