export {
  configureApiClient,
  getBaseUrl,
  getAuthHeader,
  fetchAuthenticatedFile,
  downloadAuthenticatedFile,
  request,
  requestRequired,
  ApiError,
} from "./config";
export {
  classifyApiAccessError,
  isAuthFailureError,
  isPlanLimitReachedError,
  isPremiumRequiredError,
} from "./entitlementErrors";
export type { AuthenticatedFile, ApiResponseMeta } from "./config";
export {
  configurePerfLogging,
  isPerfLoggingEnabled,
  perfLog,
  serializeQueryKey,
} from "./perf";
export {
  BILLING_CHECKOUT_PATH,
  configureBillingCheckoutDiagnostics,
  getLastBillingCheckoutAttempt,
  isBillingCheckoutDiagnosticsEnabled,
  resetBillingCheckoutDiagnosticsForTests,
  sanitizeBillingDiagnosticText,
  shouldEnableBillingCheckoutDiagnostics,
} from "./billingCheckoutDiagnostics";
export type { BillingCheckoutAttempt } from "./billingCheckoutDiagnostics";
export * from "./api";
