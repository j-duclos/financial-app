import { ApiError } from "@budget-app/api-client";

/** TanStack Query retry policy aligned with JWT refresh and validation semantics. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;

  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 422) {
      return false;
    }
    if (error.status === 429) return failureCount < 1;
    if (error.status >= 500) return failureCount < 2;
    return false;
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") return false;
    if (/network|fetch|failed/i.test(error.message)) return failureCount < 2;
  }

  return failureCount < 1;
}
