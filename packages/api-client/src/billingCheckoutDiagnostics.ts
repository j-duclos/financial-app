/** Development-only Stripe Checkout request diagnostics. Off by default. */

export const BILLING_CHECKOUT_PATH = "/api/billing/create-checkout-session/";

export type BillingCheckoutAttempt = {
  apiBaseUrl: string;
  endpoint: typeof BILLING_CHECKOUT_PATH;
  requested: true;
  networkFailure: boolean;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  contentType: string | null;
};

let diagnosticsEnabled = false;
let lastAttempt: BillingCheckoutAttempt | null = null;

export function configureBillingCheckoutDiagnostics(enabled: boolean): void {
  diagnosticsEnabled = enabled;
}

export function isBillingCheckoutDiagnosticsEnabled(): boolean {
  return diagnosticsEnabled;
}

export function getLastBillingCheckoutAttempt(): BillingCheckoutAttempt | null {
  return lastAttempt;
}

export function resetBillingCheckoutDiagnosticsForTests(): void {
  diagnosticsEnabled = false;
  lastAttempt = null;
}

export function shouldEnableBillingCheckoutDiagnostics(options: {
  isDev: boolean;
  appEnv: string;
}): boolean {
  return options.isDev || options.appEnv === "staging";
}

function apiHostFromBase(apiBaseUrl: string): string {
  try {
    const normalized = apiBaseUrl.startsWith("http") ? apiBaseUrl : `https://${apiBaseUrl}`;
    return new URL(normalized).hostname;
  } catch {
    return "unknown";
  }
}

export function sanitizeBillingDiagnosticText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/sk_(?:live|test)_[A-Za-z0-9]+/g, "[redacted-stripe-secret]")
    .replace(/whsec_[A-Za-z0-9]+/g, "[redacted-webhook-secret]")
    .replace(/Authorization:\s*[^\s]+/gi, "Authorization: [redacted]")
    .replace(/(refresh_token|access_token)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function logCheckout(lines: string[]): void {
  if (!diagnosticsEnabled) return;
  // eslint-disable-next-line no-console
  console.log(["[billing-checkout]", ...lines].join("\n"));
}

export function recordBillingCheckoutStart(apiBaseUrl: string): void {
  lastAttempt = {
    apiBaseUrl,
    endpoint: BILLING_CHECKOUT_PATH,
    requested: true,
    networkFailure: false,
    status: null,
    durationMs: null,
    error: null,
    contentType: null,
  };
  logCheckout([
    `api_host=${apiHostFromBase(apiBaseUrl)}`,
    `endpoint=${BILLING_CHECKOUT_PATH}`,
    `request_started=true`,
  ]);
}

export function recordBillingCheckoutResponse(input: {
  status: number;
  durationMs: number;
  contentType?: string | null;
}): void {
  if (lastAttempt) {
    lastAttempt = {
      ...lastAttempt,
      networkFailure: false,
      status: input.status,
      durationMs: input.durationMs,
      contentType: input.contentType ?? lastAttempt.contentType,
      error: null,
    };
  }
  logCheckout([`status=${input.status}`, `duration_ms=${input.durationMs}`]);
}

export function recordBillingCheckoutNetworkFailure(input: {
  durationMs: number;
  error: unknown;
}): void {
  const error = sanitizeBillingDiagnosticText(safeErrorText(input.error));
  if (lastAttempt) {
    lastAttempt = {
      ...lastAttempt,
      networkFailure: true,
      status: null,
      durationMs: input.durationMs,
      error,
      contentType: null,
    };
  }
  logCheckout([`network_failure=true`, `safe_error=${error}`]);
}

export function recordBillingCheckoutHttpFailure(input: {
  status: number;
  durationMs: number;
  error: unknown;
  contentType?: string | null;
}): void {
  const error = sanitizeBillingDiagnosticText(safeErrorText(input.error));
  if (lastAttempt) {
    lastAttempt = {
      ...lastAttempt,
      networkFailure: false,
      status: input.status,
      durationMs: input.durationMs,
      error,
      contentType: input.contentType ?? null,
    };
  }
  logCheckout([`status=${input.status}`, `duration_ms=${input.durationMs}`]);
}

export function safeErrorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "unknown_error";
}

export function isCheckoutNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  if (error.name === "AbortError" || error.name === "TypeError") return true;
  const message = error.message.toLowerCase();
  if (message.includes("network request failed") || message.includes("failed to fetch")) {
    return true;
  }
  if ("status" in error && typeof (error as { status?: unknown }).status === "number") {
    const status = (error as { status: number }).status;
    if (status === 0) return true;
    if (status === 504 && /timed out/i.test(error.message)) return true;
    return false;
  }
  return true;
}
