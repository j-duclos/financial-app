/**
 * Display adapter: run the shared walk once per timeline response.
 *
 * Modes:
 * - server: Django balances only; no local walk.
 * - shadow: Django walk + local walk + parity; display server values.
 * - client: Django skipped the walk (`balance_walk=client`). Local walk is
 *   displayed. Same-response server parity is not available. Fallback to
 *   server balances is allowed only when those values are actually present.
 */
import { isIsoDateString } from "./dates";
import { buildTimeline } from "./timeline";
import { dollarsToCents } from "./money";
import {
  compareTimelineParity,
  isCanonicalWalkShadowRow,
  shadowRowId,
  timelineRowToEngineInput,
  type FinancialEngineShadowReport,
  type ShadowTimelineResponse,
  type ShadowTimelineRow,
} from "./shadow";
import type { EngineAccountSnapshot, EngineTimelineRow } from "./types";

export type FinancialEngineMode = "server" | "shadow" | "client";

export type FinancialEngineDisplaySource = "server" | "client" | "server-fallback" | "unusable";

export type FinancialEngineFallbackReason =
  | "mode_server"
  | "missing_anchors"
  | "invalid_anchor"
  | "missing_account"
  | "invalid_date"
  | "malformed_money"
  | "unknown_row_type"
  | "duplicate_row_identity"
  | "unmatched_row_identity"
  | "parity_mismatch"
  | "engine_exception";

export type FinancialEngineAccountSummary = {
  account_id: number;
  account_name?: string;
  ending_balance: string;
};

export type FinancialEngineAdapterDiagnostics = {
  accounts: number;
  rows: number;
  durationMs: number;
  compareMs: number;
  totalMs: number;
  mismatches: number;
  reason?: FinancialEngineFallbackReason;
  report?: FinancialEngineShadowReport;
};

export type FinancialEngineAdapterResult<TRow extends ShadowTimelineRow = ShadowTimelineRow> = {
  source: FinancialEngineDisplaySource;
  mode: FinancialEngineMode;
  rows: TRow[];
  accountSummary?: FinancialEngineAccountSummary[];
  diagnostics: FinancialEngineAdapterDiagnostics;
};

export type FinancialEngineTimelineRequestParams = {
  include_engine_shadow?: boolean;
  balance_walk?: "client";
};

const KNOWN_ROW_TYPES = new Set(["INFLOW", "OUTFLOW", "INCOME", "EXPENSE", ""]);

export class FinancialEngineUnusablePayloadError extends Error {
  readonly reason?: FinancialEngineFallbackReason;

  constructor(reason?: FinancialEngineFallbackReason) {
    super(`Financial engine could not calculate balances (${reason ?? "unusable"})`);
    this.name = "FinancialEngineUnusablePayloadError";
    this.reason = reason;
  }
}

export function parseFinancialEngineMode(
  modeRaw?: string | boolean | null,
  legacyShadowRaw?: string | boolean | null
): FinancialEngineMode {
  if (modeRaw != null && String(modeRaw).trim() !== "") {
    const v = String(modeRaw).trim().toLowerCase();
    if (v === "client" || v === "shadow" || v === "server") return v;
    return "server";
  }
  if (legacyShadowRaw === true) return "shadow";
  if (legacyShadowRaw == null || legacyShadowRaw === false) return "server";
  const v = String(legacyShadowRaw).trim().toLowerCase();
  if (v === "client") return "client";
  if (v === "shadow" || v === "true" || v === "1" || v === "yes") return "shadow";
  if (v === "server" || v === "false" || v === "0" || v === "no") return "server";
  return "server";
}

export function financialEngineRequestsAnchors(mode: FinancialEngineMode): boolean {
  return mode === "shadow" || mode === "client";
}

/** Query flags for GET /api/timeline/ — never inferred from environment names. */
export function financialEngineTimelineRequestParams(
  mode: FinancialEngineMode
): FinancialEngineTimelineRequestParams {
  if (mode === "server") return {};
  if (mode === "shadow") return { include_engine_shadow: true };
  return { include_engine_shadow: true, balance_walk: "client" };
}

export function applyLocalBalanceWalk<TRow extends ShadowTimelineRow>(
  serverTimeline: readonly TRow[],
  localRows: readonly EngineTimelineRow[],
  today: string
): TRow[] {
  const localById = new Map(localRows.map((row) => [shadowRowId(row), row]));
  return serverTimeline.map((row) => {
    if (!isCanonicalWalkShadowRow(row, today)) return { ...row };
    const local = localById.get(shadowRowId(row));
    if (local?.balance_after == null || local.balance_after === "") return { ...row };
    return { ...row, balance_after: local.balance_after };
  });
}

function nowFn(now?: () => number): () => number {
  return now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function isMalformedMoney(value: string | number | null | undefined): boolean {
  if (value == null || value === "") return true;
  try {
    dollarsToCents(value);
    return false;
  } catch {
    return true;
  }
}

function hasDuplicateRowIdentity(rows: readonly ShadowTimelineRow[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const id = shadowRowId(row);
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

function hasUnknownRowType(rows: readonly ShadowTimelineRow[]): boolean {
  return rows.some((row) => {
    const type = String(row.type ?? "").trim().toUpperCase();
    return type !== "" && !KNOWN_ROW_TYPES.has(type);
  });
}

function lastLocalEndingByAccount(
  localRows: readonly EngineTimelineRow[],
  today: string
): Map<number, string> {
  const last = new Map<number, string>();
  for (const row of localRows) {
    if (!isCanonicalWalkShadowRow(row, today)) continue;
    if (row.balance_after == null || row.balance_after === "") continue;
    last.set(row.account_id, row.balance_after);
  }
  return last;
}

function isoDateOf(value: unknown): string {
  return String(value ?? "").trim().slice(0, 10);
}

function hasInvalidDate(rows: readonly ShadowTimelineRow[], today: string): boolean {
  if (!isIsoDateString(today)) return true;
  return rows.some((row) => !isIsoDateString(isoDateOf(row.date)));
}

function hasMissingAccount(
  rows: readonly ShadowTimelineRow[],
  accountIds: ReadonlySet<number>
): boolean {
  return rows.some((row) => !accountIds.has(Number(row.account_id)));
}

function walkIdentitiesMatch(
  inputWalk: readonly ShadowTimelineRow[],
  localWalk: readonly EngineTimelineRow[]
): boolean {
  if (inputWalk.length !== localWalk.length) return false;
  for (let i = 0; i < inputWalk.length; i += 1) {
    if (shadowRowId(inputWalk[i]) !== shadowRowId(localWalk[i])) return false;
  }
  return true;
}

function responseDeclaresClientWalk(
  response: Pick<ShadowTimelineResponse, "engine_shadow">
): boolean {
  return response.engine_shadow?.balance_walk_source === "client";
}

/** True only when the same response actually contains server-assigned balances. */
export function serverBalancesUsableForFallback(
  response: Pick<ShadowTimelineResponse, "engine_shadow" | "timeline">,
  today: string
): boolean {
  if (responseDeclaresClientWalk(response)) return false;
  const walk = (response.timeline ?? []).filter((row) => isCanonicalWalkShadowRow(row, today));
  if (walk.length === 0) return true;
  return walk.every((row) => row.balance_after != null && String(row.balance_after).trim() !== "");
}

function failureDisplaySource(
  mode: FinancialEngineMode,
  response: Pick<ShadowTimelineResponse, "engine_shadow" | "timeline">,
  today: string
): Extract<FinancialEngineDisplaySource, "server" | "server-fallback" | "unusable"> {
  if (mode !== "client") return "server";
  return serverBalancesUsableForFallback(response, today) ? "server-fallback" : "unusable";
}

function formatEngineLog(result: FinancialEngineAdapterResult<ShadowTimelineRow>): string {
  const { diagnostics: d } = result;
  let line =
    `[financial-engine] mode=${result.mode} source=${result.source}` +
    ` accounts=${d.accounts} rows=${d.rows} duration_ms=${d.durationMs}` +
    ` mismatches=${d.mismatches}`;
  if (d.reason) line += ` reason=${d.reason}`;
  return line;
}

export function resolveTimelineWithFinancialEngine<TRow extends ShadowTimelineRow>(options: {
  mode: FinancialEngineMode;
  response: Pick<ShadowTimelineResponse, "engine_shadow"> & {
    timeline: TRow[];
    account_summary?: FinancialEngineAccountSummary[];
  };
  today?: string;
  now?: () => number;
  log?: (line: string, details?: unknown) => void;
  buildTimelineFn?: typeof buildTimeline;
}): FinancialEngineAdapterResult<TRow> {
  const clock = nowFn(options.now);
  const tAll = clock();
  const rows = options.response.timeline ?? [];
  const emptyDiagnostics = (partial: Partial<FinancialEngineAdapterDiagnostics>): FinancialEngineAdapterDiagnostics => ({
    accounts: 0,
    rows: rows.length,
    durationMs: 0,
    compareMs: 0,
    mismatches: 0,
    ...partial,
    totalMs: roundMs(clock() - tAll),
  });

  const finish = (
    result: Omit<FinancialEngineAdapterResult<TRow>, "diagnostics"> & {
      diagnostics: FinancialEngineAdapterDiagnostics;
    }
  ): FinancialEngineAdapterResult<TRow> => {
    const out = { ...result, diagnostics: { ...result.diagnostics, totalMs: roundMs(clock() - tAll) } };
    if (options.mode !== "server") {
      const noisy =
        out.source === "server-fallback" ||
        out.source === "unusable" ||
        out.diagnostics.mismatches > 0 ||
        Boolean(out.diagnostics.reason);
      options.log?.(formatEngineLog(out), noisy ? out.diagnostics : undefined);
    }
    return out;
  };

  if (options.mode === "server") {
    return {
      source: "server",
      mode: "server",
      rows,
      accountSummary: options.response.account_summary,
      diagnostics: emptyDiagnostics({ reason: "mode_server" }),
    };
  }

  const shadow = options.response.engine_shadow;
  const today = options.today || shadow?.as_of || "";
  const fail = (reason: FinancialEngineFallbackReason, extra?: Partial<FinancialEngineAdapterDiagnostics>) =>
    finish({
      source: failureDisplaySource(options.mode, options.response, today),
      mode: options.mode,
      rows,
      accountSummary: options.response.account_summary,
      diagnostics: emptyDiagnostics({
        accounts: shadow?.accounts?.length ?? 0,
        mismatches: 1,
        reason,
        ...extra,
      }),
    });

  if (!shadow?.accounts?.length) {
    return fail("missing_anchors", {
      report: {
        matches: false,
        mismatches: [
          {
            rowId: "payload",
            accountId: 0,
            date: "",
            serverBalanceAfter: null,
            localBalanceAfter: null,
            differenceCents: null,
            reason: "missing_payload",
          },
        ],
        accounts: 0,
        rows: rows.length,
        durationMs: 0,
        orderMatches: false,
        payloadBytes: jsonSize(options.response),
        shadowBytes: 0,
        skipped: true,
      },
    });
  }

  if (hasInvalidDate(rows, today)) {
    return fail("invalid_date");
  }

  if (shadow.accounts.some((account) => isMalformedMoney(account.posted_balance_before_pending))) {
    return fail("invalid_anchor");
  }

  const accountIds = new Set(shadow.accounts.map((account) => Number(account.account_id)));
  if (hasMissingAccount(rows, accountIds)) {
    return fail("missing_account");
  }

  if (rows.some((row) => isMalformedMoney(row.amount))) {
    return fail("malformed_money");
  }

  if (hasUnknownRowType(rows)) {
    return fail("unknown_row_type");
  }

  if (hasDuplicateRowIdentity(rows)) {
    return fail("duplicate_row_identity");
  }

  const accounts: EngineAccountSnapshot[] = shadow.accounts.map((account) => ({
    id: account.account_id,
    posted_balance_before_pending: String(account.posted_balance_before_pending),
  }));

  try {
    const engineRows = rows.map(timelineRowToEngineInput);
    const build = options.buildTimelineFn ?? buildTimeline;
    const t0 = clock();
    const localRows = build({
      accounts,
      rows: engineRows,
      today,
    });
    const durationMs = roundMs(clock() - t0);
    const walkInput = rows.filter((row) => isCanonicalWalkShadowRow(row, today));
    const walkLocal = localRows.filter((row) => isCanonicalWalkShadowRow(row, today));

    if (!walkIdentitiesMatch(walkInput, walkLocal)) {
      return finish({
        source: failureDisplaySource(options.mode, options.response, today),
        mode: options.mode,
        rows,
        accountSummary: options.response.account_summary,
        diagnostics: {
          accounts: accounts.length,
          rows: rows.length,
          durationMs,
          compareMs: 0,
          totalMs: 0,
          mismatches: 1,
          reason: "unmatched_row_identity",
        },
      });
    }

    const canCompareServer = options.mode === "shadow" || serverBalancesUsableForFallback(options.response, today);

    if (canCompareServer) {
      const tCompare = clock();
      const compared = compareTimelineParity(walkInput, walkLocal, {
        accountSummary: options.response.account_summary,
      });
      const compareMs = roundMs(clock() - tCompare);
      const unmatched = compared.mismatches.some(
        (m) => m.reason === "missing_local" || m.reason === "missing_server"
      );
      const report: FinancialEngineShadowReport = {
        ...compared,
        accounts: accounts.length,
        rows: rows.length,
        durationMs,
        payloadBytes: jsonSize(options.response),
        shadowBytes: jsonSize(shadow),
      };

      if (unmatched) {
        return finish({
          source: failureDisplaySource(options.mode, options.response, today),
          mode: options.mode,
          rows,
          accountSummary: options.response.account_summary,
          diagnostics: {
            accounts: accounts.length,
            rows: rows.length,
            durationMs,
            compareMs,
            totalMs: 0,
            mismatches: compared.mismatches.length,
            reason: "unmatched_row_identity",
            report,
          },
        });
      }

      if (!compared.matches) {
        return finish({
          source: failureDisplaySource(options.mode, options.response, today),
          mode: options.mode,
          rows,
          accountSummary: options.response.account_summary,
          diagnostics: {
            accounts: accounts.length,
            rows: rows.length,
            durationMs,
            compareMs,
            totalMs: 0,
            mismatches: compared.mismatches.length,
            reason: "parity_mismatch",
            report,
          },
        });
      }

      if (options.mode === "shadow") {
        return finish({
          source: "server",
          mode: "shadow",
          rows,
          accountSummary: options.response.account_summary,
          diagnostics: {
            accounts: accounts.length,
            rows: rows.length,
            durationMs,
            compareMs,
            totalMs: 0,
            mismatches: 0,
            report,
          },
        });
      }
    }

    const localTimeline = applyLocalBalanceWalk(rows, localRows, today);
    const endings = lastLocalEndingByAccount(localRows, today);
    const accountSummary = (options.response.account_summary ?? []).map((summary) => ({
      ...summary,
      ending_balance: endings.get(summary.account_id) ?? summary.ending_balance,
    }));

    return finish({
      source: "client",
      mode: "client",
      rows: localTimeline,
      accountSummary,
      diagnostics: {
        accounts: accounts.length,
        rows: rows.length,
        durationMs,
        compareMs: 0,
        totalMs: 0,
        mismatches: 0,
        report: {
          matches: true,
          mismatches: [],
          accounts: accounts.length,
          rows: rows.length,
          durationMs,
          orderMatches: true,
          payloadBytes: jsonSize(options.response),
          shadowBytes: jsonSize(shadow),
        },
      },
    });
  } catch {
    return finish({
      source: failureDisplaySource(options.mode, options.response, today),
      mode: options.mode,
      rows,
      accountSummary: options.response.account_summary,
      diagnostics: emptyDiagnostics({
        accounts: accounts.length,
        mismatches: 1,
        reason: "engine_exception",
      }),
    });
  }
}
