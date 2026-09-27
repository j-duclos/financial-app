const SENSITIVE_SUBSTRINGS = [
  "public_token",
  "publicToken",
  "access_token",
  "accessToken",
  "secret",
  "password",
  "account_number",
  "accountNumber",
  "accountNumberMask",
];

export type PlaidLinkExitFields = {
  errorCode?: string;
  errorType?: string;
  displayMessage?: string;
  errorMessage?: string;
  institutionId?: string;
  institutionName?: string;
  requestId?: string;
  status?: string;
};

export class PlaidLinkExitError extends Error {
  readonly errorCode: string;
  readonly errorType: string;
  readonly requestId: string;
  readonly status: string;
  readonly institutionId: string;
  readonly institutionName: string;
  readonly userMessage: string;

  constructor(fields: PlaidLinkExitFields) {
    const userMessage = plaidExitUserMessage(fields);
    super(userMessage);
    this.name = "PlaidLinkExitError";
    this.errorCode = (fields.errorCode ?? "").trim();
    this.errorType = (fields.errorType ?? "").trim();
    this.requestId = (fields.requestId ?? "").trim();
    this.status = (fields.status ?? "").trim();
    this.institutionId = (fields.institutionId ?? "").trim();
    this.institutionName = (fields.institutionName ?? "").trim();
    this.userMessage = userMessage;
  }
}

export function plaidExitUserMessage(fields: PlaidLinkExitFields): string {
  const code = (fields.errorCode ?? "").trim().toUpperCase();
  const display = (fields.displayMessage ?? "").trim();
  if (code === "ITEM_LOCKED" || /account is locked/i.test(display)) {
    return (
      "Plaid stopped this bank login (ITEM_LOCKED). That is Plaid’s connector, not FlowSight, " +
      "and it is often wrong after failed OAuth. If you can still sign in at the bank’s own app, " +
      "wait 15–30 minutes, then tap Connect bank again."
    );
  }
  if (display) return display;
  if (code) return "Bank linking didn’t finish. Try again.";
  return "Bank linking didn’t finish. Try again.";
}

export function summarizePlaidExit(fields: PlaidLinkExitFields): Record<string, string> {
  return omitSensitive({
    errorCode: (fields.errorCode ?? "").trim(),
    errorType: (fields.errorType ?? "").trim(),
    displayMessage: (fields.displayMessage ?? "").trim(),
    errorMessage: (fields.errorMessage ?? "").trim(),
    institutionId: (fields.institutionId ?? "").trim(),
    institutionName: (fields.institutionName ?? "").trim(),
    requestId: (fields.requestId ?? "").trim(),
    status: (fields.status ?? "").trim(),
  });
}

const DIAGNOSTIC_EVENTS = new Set([
  "OPEN_OAUTH",
  "CLOSE_OAUTH",
  "FAIL_OAUTH",
  "HANDOFF",
  "SELECT_INSTITUTION",
  "MATCHED_SELECT_INSTITUTION",
  "EXIT",
  "ERROR",
  "OPEN",
]);

export function shouldLogPlaidLinkEvent(eventName: string): boolean {
  return DIAGNOSTIC_EVENTS.has(String(eventName || "").trim());
}

export function summarizePlaidLinkEvent(event: {
  eventName?: string;
  metadata?: Record<string, unknown> | null;
}): Record<string, string> {
  const meta = event.metadata ?? {};
  return omitSensitive({
    eventName: String(event.eventName ?? "").trim(),
    viewName: String(meta.viewName ?? "").trim(),
    errorCode: String(meta.errorCode ?? "").trim(),
    errorType: String(meta.errorType ?? "").trim(),
    requestId: String(meta.requestId ?? "").trim(),
    institutionId: String(meta.institutionId ?? "").trim(),
    institutionName: String(meta.institutionName ?? "").trim(),
    exitStatus: String(meta.exitStatus ?? "").trim(),
  });
}

export function formatPlaidDiagnosticLog(kind: string, fields: Record<string, string>): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}=${value}`);
  return [`[plaid-link ${kind}]`, ...parts].join(" ");
}

export function payloadLooksSensitive(value: unknown): boolean {
  const blob = JSON.stringify(value ?? "").toLowerCase();
  return SENSITIVE_SUBSTRINGS.some((needle) => blob.includes(needle.toLowerCase()));
}

function omitSensitive(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_SUBSTRINGS.some((needle) => key.toLowerCase().includes(needle.toLowerCase()))) {
      continue;
    }
    if (payloadLooksSensitive(value)) continue;
    out[key] = value;
  }
  return out;
}

export function logPlaidLinkDiagnostic(kind: string, fields: Record<string, string>): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  if (payloadLooksSensitive(fields)) return;
  // eslint-disable-next-line no-console
  console.log(formatPlaidDiagnosticLog(kind, fields));
}
