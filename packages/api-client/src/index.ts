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
export {
  FORGOT_PASSWORD_PATH,
  RESEND_VERIFICATION_PATH,
  classifyResendVerificationDetail,
  configureAuthRecoveryDiagnostics,
  getLastAuthRecoveryAttempt,
  isAuthRecoveryDiagnosticsEnabled,
  resetAuthRecoveryDiagnosticsForTests,
  sanitizeAuthRecoveryDiagnosticText,
  shouldEnableAuthRecoveryDiagnostics,
} from "./authRecoveryDiagnostics";
export type { BillingCheckoutAttempt } from "./billingCheckoutDiagnostics";
export * from "./api";
