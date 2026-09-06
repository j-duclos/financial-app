const SENSITIVE_KEY_PATTERN =
  /^(password|passwd|current_password|new_password|new_password_confirm|secret|secret_key|api_key|stripe_secret|plaid_secret|token|uid|authorization|cookie|csrf|access_token|refresh|refresh_token|access_token_cipher|cipher|card_number|cvc|cvv|account_number|routing_number|ssn|memo|payee|imported_description)$/i;

const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-csrftoken|x-api-key)$/i;

const SECRET_IN_TEXT =
  /access-(?:sandbox|production|development)-[A-Za-z0-9_-]+|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|Bearer\s+\S+|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi;

export type ScrubableSentryEvent = {
  request?: unknown;
  extra?: unknown;
  contexts?: unknown;
  exception?: unknown;
  breadcrumbs?: unknown;
  user?: unknown;
  [key: string]: unknown;
};

export function isSensitiveKey(key: string): boolean {
  SENSITIVE_KEY_PATTERN.lastIndex = 0;
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function scrubSecretText(value: string): string {
  SECRET_IN_TEXT.lastIndex = 0;
  return value.replace(SECRET_IN_TEXT, "[Filtered]");
}

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? "[Filtered]" : redact(nested);
    }
    return out;
  }
  if (typeof value === "string") return scrubSecretText(value);
  return value;
}

function scrubQueryString(value: unknown): unknown {
  if (typeof value === "string" && /(?:^|&)(?:token|uid|code|access|refresh)=/i.test(value)) {
    return "[Filtered]";
  }
  return redact(value);
}

export function scrubHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== "object") return headers;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    out[key] = SENSITIVE_HEADER_PATTERN.test(key) || isSensitiveKey(key) ? "[Filtered]" : value;
  }
  return out;
}

export function scrubSentryEvent(event: ScrubableSentryEvent): ScrubableSentryEvent {
  const next: ScrubableSentryEvent = { ...event };
  const request = next.request;
  if (request && typeof request === "object") {
    const req = { ...(request as Record<string, unknown>) };
    if ("headers" in req) req.headers = scrubHeaders(req.headers);
    if ("cookies" in req) req.cookies = "[Filtered]";
    if ("data" in req) req.data = "[Filtered]";
    if ("query_string" in req) req.query_string = scrubQueryString(req.query_string);
    next.request = req;
  }
  if (next.extra && typeof next.extra === "object") {
    next.extra = redact(next.extra);
  }
  if (next.contexts && typeof next.contexts === "object") {
    next.contexts = redact(next.contexts);
  }
  if (next.exception && typeof next.exception === "object") {
    next.exception = redact(next.exception);
  }
  if (next.breadcrumbs && typeof next.breadcrumbs === "object") {
    next.breadcrumbs = redact(next.breadcrumbs);
  }
  const user = next.user;
  if (user && typeof user === "object") {
    const raw = user as Record<string, unknown>;
    next.user = "id" in raw ? { id: raw.id } : {};
  }
  return next;
}
