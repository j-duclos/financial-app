/**
 * Lightweight mobile startup / reopen timing.
 * Development logs only. Never records financial values, names, or tokens.
 */

export type StartupLaunchType = "cold_launch" | "foreground_resume";

export type StartupQueryCacheState = "cache_hit" | "stale_refetch" | "network_fetch";

export type StartupQueryName =
  | "profile"
  | "household"
  | "accounts"
  | "transactions"
  | "timeline"
  | "dashboard_summary_fast"
  | "dashboard_details";

export type StartupEventName =
  | "app_started"
  | "app_became_active"
  | "auth_ready"
  | "profile_request_started"
  | "profile_request_finished"
  | "household_request_started"
  | "household_request_finished"
  | "accounts_request_started"
  | "accounts_request_finished"
  | "dashboard_summary_fast_request_started"
  | "dashboard_summary_fast_request_finished"
  | "dashboard_details_request_started"
  | "dashboard_details_request_finished"
  | "transactions_prefetch_started"
  | "transactions_prefetch_finished"
  | "timeline_request_started"
  | "timeline_request_finished"
  | "home_shell_mounted"
  | "home_accounts_visible"
  | "home_balances_visible"
  | "home_recent_activity_visible"
  | "home_forecast_visible"
  | "home_primary_content_visible"
  | "home_data_ready"
  | "first_screen_ready"
  | "plaid_refresh_started"
  | "plaid_refresh_finished";

export type StartupRequestRecord = {
  path: string;
  method: string;
  startMs: number;
  durationMs: number;
  status: number;
  cache: string | null;
  clientElapsedMs: number;
  serverMs: number | null;
};

export type StartupEventMetadata = Record<string, string | number | boolean | null | undefined>;

export type StartupQueryPhase = {
  cache: StartupQueryCacheState;
  durationMs: number;
  status: "ok" | "error";
};

export type PlaidRefreshTiming = {
  durationMs: number;
  changedData: boolean;
};

export type TimelineBackendMeta = {
  cache?: string | null;
  serverDurationMs?: number | null;
  balanceWalkMode?: string | null;
  requestId?: string | null;
};

export type StartupTraceSnapshot = {
  type: StartupLaunchType;
  correlationId: string;
  startedAt: number;
  finishedAt: number | null;
  timeSinceBackgroundMs: number | null;
  events: Partial<Record<StartupEventName, number>>;
  queries: Partial<Record<StartupQueryName, StartupQueryPhase>>;
  requests: StartupRequestRecord[];
  plaid: PlaidRefreshTiming | null;
  timelineBackend: TimelineBackendMeta | null;
  summary: string | null;
};

const SENSITIVE_KEY =
  /account|payee|description|balance|token|password|email|username|display.?name|memo|amount|payee/i;

type ActiveTrace = {
  type: StartupLaunchType;
  correlationId: string;
  startedAt: number;
  finishedAt: number | null;
  timeSinceBackgroundMs: number | null;
  events: Map<StartupEventName, number>;
  queries: Map<StartupQueryName, StartupQueryPhase>;
  requests: StartupRequestRecord[];
  plaid: PlaidRefreshTiming | null;
  timelineBackend: TimelineBackendMeta | null;
  inFlight: number;
  apiInFlight: number;
  prefetchOpen: boolean;
  allowFinishWithoutHome: boolean;
  readyToFinish: boolean;
};

let active: ActiveTrace | null = null;
let lastSnapshot: StartupTraceSnapshot | null = null;
let logger: (line: string) => void = (line) => {
  // eslint-disable-next-line no-console
  console.debug(line);
};

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isDev(): boolean {
  return typeof __DEV__ === "undefined" || __DEV__;
}

function newCorrelationId(): string {
  const rand = Math.floor(Math.random() * 1_000_000).toString(36);
  return `fs-${Date.now().toString(36)}-${rand}`;
}

export function setStartupTraceLogger(fn: ((line: string) => void) | null): void {
  logger = fn ?? ((line) => {
    // eslint-disable-next-line no-console
    console.debug(line);
  });
}

export function sanitizeStartupMetadata(
  metadata?: StartupEventMetadata
): Record<string, string | number | boolean> {
  if (!metadata) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null) continue;
    if (SENSITIVE_KEY.test(key)) continue;
    if (typeof value === "string" && SENSITIVE_KEY.test(value)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

function emit(line: string): void {
  if (!isDev()) return;
  logger(line);
}

function formatMeta(metadata?: StartupEventMetadata): string {
  const clean = sanitizeStartupMetadata(metadata);
  const parts = Object.entries(clean).map(([k, v]) => `${k}=${v}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function getStartupCorrelationId(): string | null {
  return active?.correlationId ?? lastSnapshot?.correlationId ?? null;
}

export function isStartupTraceActive(): boolean {
  return active != null && active.finishedAt == null;
}

export function startStartupTrace(input: {
  type: StartupLaunchType;
  timeSinceBackgroundMs?: number | null;
}): void {
  if (active && active.finishedAt == null) {
    finishStartupTrace();
  }
  active = {
    type: input.type,
    correlationId: newCorrelationId(),
    startedAt: nowMs(),
    finishedAt: null,
    timeSinceBackgroundMs: input.timeSinceBackgroundMs ?? null,
    events: new Map(),
    queries: new Map(),
    requests: [],
    plaid: null,
    timelineBackend: null,
    inFlight: 0,
    apiInFlight: 0,
    prefetchOpen: false,
    allowFinishWithoutHome: false,
    readyToFinish: false,
  };
  emit(
    `[startup] start type=${input.type} correlation_id=${active.correlationId}` +
      (active.timeSinceBackgroundMs != null
        ? ` time_since_background_ms=${Math.round(active.timeSinceBackgroundMs)}`
        : "")
  );
}

export function markStartupEvent(name: StartupEventName, metadata?: StartupEventMetadata): void {
  if (!active || active.finishedAt != null) return;
  if (active.events.has(name)) return;
  if (name === "first_screen_ready" && metadata?.surface === "auth") {
    active.allowFinishWithoutHome = true;
  }
  const at = nowMs();
  active.events.set(name, at);
  const elapsed = Math.round(at - active.startedAt);
  emit(`[startup] ${name} +${elapsed}ms${formatMeta(metadata)}`);
  if (name === "transactions_prefetch_started") active.prefetchOpen = true;
  if (name === "transactions_prefetch_finished") active.prefetchOpen = false;
  maybeFinishStartupTrace();
}

export function markStartupQueryStarted(
  query: StartupQueryName,
  cache: StartupQueryCacheState
): void {
  if (!active || active.finishedAt != null) return;
  const started = `${query}_request_started` as StartupEventName;
  if (!active.events.has(started)) {
    active.inFlight += 1;
  }
  markStartupEvent(started, { cache });
}

export function markStartupQueryFinished(
  query: StartupQueryName,
  phase: StartupQueryPhase
): void {
  if (!active || active.finishedAt != null) return;
  if (!active.queries.has(query)) {
    active.inFlight = Math.max(0, active.inFlight - 1);
    active.queries.set(query, {
      cache: phase.cache,
      durationMs: Math.max(0, Math.round(phase.durationMs)),
      status: phase.status,
    });
    emit(
      `[startup] ${query} cache=${phase.cache} duration_ms=${Math.round(phase.durationMs)} status=${phase.status}`
    );
  }
  markStartupEvent(`${query}_request_finished` as StartupEventName, {
    cache: phase.cache,
    duration_ms: Math.round(phase.durationMs),
    status: phase.status,
  });
}

export async function runTimedStartupQuery<T>(
  query: StartupQueryName,
  cache: StartupQueryCacheState,
  fn: () => Promise<T>
): Promise<T> {
  markStartupQueryStarted(query, cache);
  const t0 = nowMs();
  try {
    const result = await fn();
    markStartupQueryFinished(query, {
      cache,
      durationMs: nowMs() - t0,
      status: "ok",
    });
    return result;
  } catch (error) {
    markStartupQueryFinished(query, {
      cache,
      durationMs: nowMs() - t0,
      status: "error",
    });
    throw error;
  }
}

export function recordPlaidRefreshTiming(timing: PlaidRefreshTiming): void {
  if (!active || active.finishedAt != null) return;
  if (active.plaid != null) return;
  active.plaid = {
    durationMs: Math.max(0, Math.round(timing.durationMs)),
    changedData: timing.changedData,
  };
  markStartupEvent("plaid_refresh_started");
  markStartupEvent("plaid_refresh_finished", {
    duration_ms: active.plaid.durationMs,
    changed_data: timing.changedData,
  });
}

export async function tracePlaidRefresh<T>(
  fn: () => Promise<T>,
  changedData: (result: T) => boolean
): Promise<T> {
  const t0 = nowMs();
  markStartupEvent("plaid_refresh_started");
  try {
    const result = await fn();
    recordPlaidRefreshTiming({
      durationMs: nowMs() - t0,
      changedData: changedData(result),
    });
    return result;
  } catch (error) {
    recordPlaidRefreshTiming({ durationMs: nowMs() - t0, changedData: false });
    throw error;
  }
}

export function recordTimelineBackendMeta(meta: TimelineBackendMeta): void {
  if (!active || active.finishedAt != null) return;
  active.timelineBackend = {
    cache: meta.cache ?? active.timelineBackend?.cache ?? null,
    serverDurationMs: meta.serverDurationMs ?? active.timelineBackend?.serverDurationMs ?? null,
    balanceWalkMode: meta.balanceWalkMode ?? active.timelineBackend?.balanceWalkMode ?? null,
    requestId: meta.requestId ?? active.correlationId,
  };
}

function safeApiPath(path: string): string {
  const trimmed = path.split("?")[0] ?? path;
  return trimmed.slice(0, 120);
}

export function recordStartupRequestStart(_path: string, _method: string): void {
  if (!active || active.finishedAt != null) return;
  active.apiInFlight += 1;
}

export function recordStartupRequest(input: {
  path: string;
  method: string;
  durationMs: number;
  status: number;
  cache?: string | null;
  serverMs?: number | null;
}): void {
  if (!active || active.finishedAt != null) return;
  active.apiInFlight = Math.max(0, active.apiInFlight - 1);
  const durationMs = Math.max(0, Math.round(input.durationMs));
  const endMs = Math.round(nowMs() - active.startedAt);
  const startMs = Math.max(0, endMs - durationMs);
  const record: StartupRequestRecord = {
    path: safeApiPath(input.path),
    method: input.method,
    startMs,
    durationMs,
    status: input.status,
    cache: input.cache ?? null,
    clientElapsedMs: durationMs,
    serverMs: input.serverMs != null && Number.isFinite(input.serverMs) ? Math.round(input.serverMs) : null,
  };
  active.requests.push(record);
  const gap =
    record.serverMs != null ? Math.max(0, record.clientElapsedMs - record.serverMs) : null;
  emit(
    `[startup-request] ${record.method} ${record.path} start_ms=${record.startMs} duration_ms=${record.durationMs} status=${record.status} cache=${record.cache ?? "n/a"} client_elapsed_ms=${record.clientElapsedMs} server_processing_ms=${record.serverMs ?? "n/a"}` +
      (gap != null ? ` client_server_gap_ms=${gap}` : "")
  );
  maybeFinishStartupTrace();
}

export function getStartupRequestsSorted(): StartupRequestRecord[] {
  const rows = active?.requests ?? lastSnapshot?.requests ?? [];
  return [...rows].sort((a, b) => b.durationMs - a.durationMs);
}

export function classifyReactQueryCache(input: {
  dataUpdatedAt?: number;
  hasData: boolean;
  isInvalidated?: boolean;
  staleTimeMs: number;
  now?: number;
}): StartupQueryCacheState {
  if (!input.hasData) return "network_fetch";
  const now = input.now ?? Date.now();
  const updatedAt = input.dataUpdatedAt ?? 0;
  const age = now - updatedAt;
  if (input.isInvalidated || age >= input.staleTimeMs) return "stale_refetch";
  return "cache_hit";
}

function queryMs(name: StartupQueryName): number {
  return active?.queries.get(name)?.durationMs ?? lastSnapshot?.queries[name]?.durationMs ?? 0;
}

function queryCache(name: StartupQueryName): string {
  return (
    active?.queries.get(name)?.cache ??
    lastSnapshot?.queries[name]?.cache ??
    "n/a"
  );
}

function eventMs(trace: ActiveTrace, name: StartupEventName, fallback: number): number {
  const at = trace.events.get(name);
  return at != null ? Math.round(at - trace.startedAt) : fallback;
}

function buildRequestTable(trace: ActiveTrace): string[] {
  const sorted = [...trace.requests].sort((a, b) => b.durationMs - a.durationMs);
  if (sorted.length === 0) return [];
  const lines = ["[startup-requests]"];
  for (const row of sorted) {
    lines.push(
      `${row.path} start_ms=${row.startMs} duration_ms=${row.durationMs} status=${row.status} cache=${row.cache ?? "n/a"} client_elapsed_ms=${row.clientElapsedMs} server_processing_ms=${row.serverMs ?? "n/a"}`
    );
  }
  return lines;
}

function buildSummary(trace: ActiveTrace, finishedAt: number): string {
  const total = Math.round(finishedAt - trace.startedAt);
  const firstScreen = trace.events.get("first_screen_ready");
  const firstScreenMs = firstScreen != null ? Math.round(firstScreen - trace.startedAt) : total;
  const primaryMs = eventMs(trace, "home_primary_content_visible", firstScreenMs);
  const lines = [
    "[startup-summary]",
    `type=${trace.type}`,
    `correlation_id=${trace.correlationId}`,
    `total_ms=${total}`,
    `profile_ms=${trace.queries.get("profile")?.durationMs ?? 0}`,
    `household_ms=${trace.queries.get("household")?.durationMs ?? 0}`,
    `accounts_ms=${trace.queries.get("accounts")?.durationMs ?? 0}`,
    `dashboard_summary_fast_ms=${trace.queries.get("dashboard_summary_fast")?.durationMs ?? 0}`,
    `dashboard_details_ms=${trace.queries.get("dashboard_details")?.durationMs ?? 0}`,
    `transactions_ms=${trace.queries.get("transactions")?.durationMs ?? 0}`,
    `timeline_ms=${trace.queries.get("timeline")?.durationMs ?? 0}`,
    `timeline_cache=${trace.timelineBackend?.cache ?? trace.queries.get("timeline")?.cache ?? "n/a"}`,
    `plaid_refresh_ms=${trace.plaid?.durationMs ?? 0}`,
    `first_screen_ready_ms=${firstScreenMs}`,
    `home_primary_content_ms=${primaryMs}`,
    `home_accounts_ms=${eventMs(trace, "home_accounts_visible", 0)}`,
    `home_balances_ms=${eventMs(trace, "home_balances_visible", 0)}`,
    `home_forecast_ms=${eventMs(trace, "home_forecast_visible", 0)}`,
  ];
  if (trace.timeSinceBackgroundMs != null) {
    lines.splice(3, 0, `time_since_background_ms=${Math.round(trace.timeSinceBackgroundMs)}`);
  }
  if (trace.plaid) {
    lines.push(`plaid_refresh_changed_data=${trace.plaid.changedData}`);
  }
  if (trace.timelineBackend?.serverDurationMs != null) {
    lines.push(`timeline_server_ms=${Math.round(trace.timelineBackend.serverDurationMs)}`);
  }
  if (trace.timelineBackend?.balanceWalkMode) {
    lines.push(`timeline_balance_walk=${trace.timelineBackend.balanceWalkMode}`);
  }
  lines.push(...buildRequestTable(trace));
  return lines.join("\n");
}

function toSnapshot(trace: ActiveTrace): StartupTraceSnapshot {
  const events: Partial<Record<StartupEventName, number>> = {};
  for (const [name, at] of trace.events) events[name] = at;
  const queries: Partial<Record<StartupQueryName, StartupQueryPhase>> = {};
  for (const [name, phase] of trace.queries) queries[name] = phase;
  return {
    type: trace.type,
    correlationId: trace.correlationId,
    startedAt: trace.startedAt,
    finishedAt: trace.finishedAt,
    timeSinceBackgroundMs: trace.timeSinceBackgroundMs,
    events,
    queries,
    requests: [...trace.requests],
    plaid: trace.plaid,
    timelineBackend: trace.timelineBackend,
    summary: trace.finishedAt != null ? buildSummary(trace, trace.finishedAt) : null,
  };
}

export function requestStartupTraceFinish(): void {
  if (!active || active.finishedAt != null) return;
  active.readyToFinish = true;
  maybeFinishStartupTrace();
}

export function maybeFinishStartupTrace(): void {
  if (!active || active.finishedAt != null) return;
  if (active.inFlight > 0) return;
  if (active.apiInFlight > 0) return;
  if (active.prefetchOpen) return;
  const canFinish =
    active.events.has("transactions_prefetch_finished") ||
    (active.allowFinishWithoutHome && active.events.has("first_screen_ready")) ||
    active.readyToFinish;
  if (!canFinish) return;
  finishStartupTrace();
}

export function finishStartupTrace(): StartupTraceSnapshot | null {
  if (!active) return lastSnapshot;
  if (active.finishedAt != null) return lastSnapshot;
  const finishedAt = nowMs();
  active.finishedAt = finishedAt;
  const summary = buildSummary(active, finishedAt);
  emit(summary);
  lastSnapshot = toSnapshot(active);
  lastSnapshot.summary = summary;
  active = null;
  return lastSnapshot;
}

export function getStartupTraceSnapshot(): StartupTraceSnapshot | null {
  if (active) return toSnapshot(active);
  return lastSnapshot;
}

export function resetStartupTraceForTests(): void {
  active = null;
  lastSnapshot = null;
}

export function startupQueryDuration(name: StartupQueryName): number {
  return queryMs(name);
}

export function startupQueryCacheState(name: StartupQueryName): string {
  return queryCache(name);
}
