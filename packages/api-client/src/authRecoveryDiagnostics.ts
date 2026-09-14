/**
 * Development/preview diagnostics for public auth-recovery HTTP.
 * Never log emails, tokens, auth headers, or passwords.
 */

export const FORGOT_PASSWORD_PATH = "/api/auth/forgot-password/";
export const RESEND_VERIFICATION_PATH = "/api/auth/resend-verification/";

export type AuthRecoveryAction = "forgot-password" | "resend-verification";

export type ResendVerificationOutcome =
  | "sent"
  | "already_verified"
  | "missing_email"
  | "http_error"
  | "network_failure";

export type AuthRecoveryAttempt = {
  action: AuthRecoveryAction;
  apiBaseUrl: string;
  endpoint: string;
  requested: true;
  networkFailure: boolean;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  outcome?: ResendVerificationOutcome;
};

let diagnosticsEnabled = false;
let lastAttempt: AuthRecoveryAttempt | null = null;

export function configureAuthRecoveryDiagnostics(enabled: boolean): void {
  diagnosticsEnabled = enabled;
}

export function isAuthRecoveryDiagnosticsEnabled(): boolean {
  return diagnosticsEnabled;
}

export function getLastAuthRecoveryAttempt(): AuthRecoveryAttempt | null {
  return lastAttempt;
}

export function resetAuthRecoveryDiagnosticsForTests(): void {
  diagnosticsEnabled = false;
  lastAttempt = null;
}

export function shouldEnableAuthRecoveryDiagnostics(options: {
  isDev: boolean;
  appEnv: string;
}): boolean {
  return options.isDev || options.appEnv === "staging";
}

function originFromBase(apiBaseUrl: string): string {
  const trimmed = (apiBaseUrl ?? "").trim();
  if (!trimmed) return "unset";
  try {
    const normalized = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "invalid";
  }
}

export function sanitizeAuthRecoveryDiagnosticText(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/[?&](uid|token)=[^&\s]+/gi, (_, key: string) => `${key}=[redacted]`)
    .replace(/\b(uid|token)=[^\s&]+/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]")
    .replace(/Authorization:\s*[^\s]+/gi, "Authorization: [redacted]")
    .replace(/(refresh_token|access_token|password|new_password)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function logRecovery(lines: string[]): void {
  if (!diagnosticsEnabled) return;
  // eslint-disable-next-line no-console
  console.log(["[auth-recovery]", ...lines].join("\n"));
}

function safeErrorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "unknown_error";
}

export function classifyResendVerificationDetail(
  detail: string | undefined,
  status: number
): ResendVerificationOutcome {
  if (status === 0) return "network_failure";
  if (status === 400) return "missing_email";
  if (status >= 400) return "http_error";
  const text = (detail ?? "").toLowerCase();
  if (text.includes("already verified")) return "already_verified";
  if (text.includes("add an email")) return "missing_email";
  return "sent";
}

export function recordForgotPasswordStart(apiBaseUrl: string): void {
  lastAttempt = {
    action: "forgot-password",
    apiBaseUrl,
    endpoint: FORGOT_PASSWORD_PATH,
    requested: true,
    networkFailure: false,
    status: null,
    durationMs: null,
    error: null,
  };
  logRecovery([
    "action=forgot-password",
    `api_host=${originFromBase(apiBaseUrl)}`,
    `endpoint=${FORGOT_PASSWORD_PATH}`,
    "request_started=true",
  ]);
}

export function recordForgotPasswordResponse(input: {
  status: number;
  durationMs: number;
  transport?: string;
}): void {
  if (lastAttempt) {
    lastAttempt = {
      ...lastAttempt,
      networkFailure: false,
      status: input.status,
      durationMs: input.durationMs,
      error: null,
    };
  }
  logRecovery([
    "action=forgot-password",
    `status=${input.status}`,
    `duration_ms=${input.durationMs}`,
    ...(input.transport ? [`transport=${input.transport}`] : []),
  ]);
}

export function recordForgotPasswordNetworkFailure(input: { durationMs: number; error: unknown }): void {
  const error = sanitizeAuthRecoveryDiagnosticText(safeErrorText(input.error));
  if (lastAttempt) {
    lastAttempt = {
      ...lastAttempt,
      networkFailure: true,
      status: null,
      durationMs: input.durationMs,
      error,
    };
  }
  logRecovery([
    "action=forgot-password",
    "network_failure=true",
    `safe_error=${error}`,
  ]);
}

export function recordResendVerificationStart(apiBaseUrl: string): void {
  lastAttempt = {
    action: "resend-verification",
    apiBaseUrl,
    endpoint: RESEND_VERIFICATION_PATH,
    requested: true,
    networkFailure: false,
    status: null,
    durationMs: null,
    error: null,
  };
  logRecovery([
    "action=resend-verification",
    `api_host=${originFromBase(apiBaseUrl)}`,
    `endpoint=${RESEND_VERIFICATION_PATH}`,
    "request_started=true",
  ]);
}

export function classifyEmailTransport(value: string | undefined): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw === "console" || raw === "dummy" || raw === "locmem" || raw === "file") return raw;
  if (raw === "smtp" || raw === "provider") return raw;
  return "other";
}

export function recordResendVerificationResponse(input: {
  status: number;
  durationMs: number;
  detail?: string;
  transport?: string;
}): void {
  const outcome = classifyResendVerificationDetail(input.detail, input.status);
  const transport = classifyEmailTransport(input.transport);
  const inboxSend = outcome === "sent" && (transport === "smtp" || transport === "provider");
  if (lastAttempt) {
    lastAttempt = {
      ...lastAttempt,
      networkFailure: false,
      status: input.status,
      durationMs: input.durationMs,
      error: null,
      outcome,
    };
  }
  logRecovery([
    "action=resend-verification",
    `status=${input.status}`,
    `duration_ms=${input.durationMs}`,
    `outcome=${outcome}`,
    `transport=${transport}`,
    `smtp_to_inbox=${inboxSend}`,
    `suspiciously_fast=${outcome === "sent" && input.durationMs < 1000}`,
  ]);
}

export function recordResendVerificationNetworkFailure(input: {
  durationMs: number;
  error: unknown;
}): void {
  const error = sanitizeAuthRecoveryDiagnosticText(safeErrorText(input.error));
  if (lastAttempt) {
    lastAttempt = {
      ...lastAttempt,
      networkFailure: true,
      status: null,
      durationMs: input.durationMs,
      error,
      outcome: "network_failure",
    };
  }
  logRecovery([
    "action=resend-verification",
    "network_failure=true",
    "outcome=network_failure",
    "smtp_attempted=false",
    `safe_error=${error}`,
  ]);
}

export function isAuthRecoveryNetworkFailure(error: unknown): boolean {
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
