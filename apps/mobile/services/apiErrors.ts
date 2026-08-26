export { ApiError } from "@budget-app/api-client";
import { ApiError } from "@budget-app/api-client";

export function describeApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Your session expired. Please sign in again.";
    if (err.status === 403) return "You do not have permission to do that.";
    if (err.status === 404) return "That resource was not found.";
    if (err.status === 422) return err.message || "Please check your input and try again.";
    if (err.status >= 500) return "The server had a problem. Please try again.";
    return err.message || `Request failed (${err.status})`;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return "The request was cancelled.";
    if (/network|fetch|failed/i.test(err.message)) {
      return "Network unavailable. Check your connection and try again.";
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/** Map DRF validation messages embedded in ApiError.message when present. */
export function fieldErrorsFromApiError(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  try {
    const parsed = JSON.parse(err.message) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
      else if (Array.isArray(value) && typeof value[0] === "string") out[key] = value[0];
    }
    return out;
  } catch {
    return err.message ? { detail: err.message } : {};
  }
}
