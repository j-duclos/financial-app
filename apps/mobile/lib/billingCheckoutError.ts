import {
  ApiError,
  getLastBillingCheckoutAttempt,
  sanitizeBillingDiagnosticText,
} from "@budget-app/api-client";
import { getApiBaseUrl } from "@/constants/env";
import { BILLING_UNAVAILABLE_MESSAGE } from "@/lib/billing";

const CHECKOUT_ENDPOINT = "/api/billing/create-checkout-session/";

export type BillingCheckoutErrorDiagnostic = {
  error_type: string;
  status: string;
  message: string;
  api_base_url: string;
  endpoint: string;
  network_error: string;
  response_status: string;
  response_content_type: string;
};

export function formatBillingCheckoutErrorLog(fields: BillingCheckoutErrorDiagnostic): string {
  return [
    "[billing-checkout-error]",
    `error_type=${fields.error_type}`,
    `status=${fields.status}`,
    `message=${fields.message}`,
    `api_base_url=${fields.api_base_url}`,
    `endpoint=${fields.endpoint}`,
    `network_error=${fields.network_error}`,
    `response_status=${fields.response_status}`,
    `response_content_type=${fields.response_content_type}`,
  ].join("\n");
}

export function buildBillingCheckoutErrorDiagnostic(
  error: unknown
): BillingCheckoutErrorDiagnostic {
  const attempt = getLastBillingCheckoutAttempt();
  const apiError = error instanceof ApiError ? error : null;
  const errorType = error instanceof Error ? error.name : typeof error;
  const status = apiError != null ? String(apiError.status) : "";
  const networkError = attempt?.networkFailure === true || apiError == null;
  return {
    error_type: errorType,
    status,
    message: sanitizeBillingDiagnosticText(
      apiError?.message || (error instanceof Error ? error.message : String(error))
    ),
    api_base_url: attempt?.apiBaseUrl || getApiBaseUrl(),
    endpoint: attempt?.endpoint || CHECKOUT_ENDPOINT,
    network_error: String(networkError),
    response_status:
      attempt?.status != null ? String(attempt.status) : status,
    response_content_type: sanitizeBillingDiagnosticText(
      attempt?.contentType || apiError?.contentType || ""
    ),
  };
}

/** Development-only. Does not change the user-facing Upgrade alert. */
export function logBillingCheckoutErrorIfDev(error: unknown): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  // eslint-disable-next-line no-console
  console.log(formatBillingCheckoutErrorLog(buildBillingCheckoutErrorDiagnostic(error)));
}

export function productionUpgradeAlertUnchanged(): string {
  return BILLING_UNAVAILABLE_MESSAGE;
}
