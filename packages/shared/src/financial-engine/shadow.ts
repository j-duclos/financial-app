/**
 * Shadow-mode DTOs and parity comparison for the client financial engine.
 *
 * Django remains authoritative. This module only observes whether the Phase 1
 * walk reproduces server `balance_after` values.
 */
import { buildTimeline, isForecastTimelineRow, isPendingExpectedTimelineRow } from "./timeline";
import { dollarsToCents } from "./money";
import type { EngineAccountSnapshot, EngineTimelineRow, EngineTimelineRowInput } from "./types";

export type FinancialEngineShadowAccount = {
  account_id: number;
  posted_balance_before_pending: string;
};

export type FinancialEngineBalanceWalkSource = "server" | "client";

export type FinancialEngineShadowPayload = {
  as_of: string;
  /** Present from Phase 4. `client` means Django skipped the canonical walk. */
  balance_walk_source?: FinancialEngineBalanceWalkSource;
  accounts: FinancialEngineShadowAccount[];
};

export type ShadowTimelineRow = {
  account_id: number;
  date: string;
  amount: string;
  type?: string;
  status?: string;
  source?: string;
  txn_source?: string | null;
  description?: string;
  transaction_id?: number | null;
  rule_id?: number | null;
  import_match_status?: string | null;
  plaid_transaction_id?: string | null;
  financially_active?: boolean;
  balance_after?: string | null;
};

export type ShadowTimelineResponse = {
  timeline: ShadowTimelineRow[];
  account_summary?: { account_id: number; ending_balance: string }[];
  engine_shadow?: FinancialEngineShadowPayload;
};

export type TimelineParityMismatchReason =
  | "balance"
  | "missing_local"
  | "missing_server"
  | "order"
  | "ending"
  | "missing_payload";

export type TimelineParityMismatch = {
  rowId: string;
  accountId: number;
  date: string;
  serverBalanceAfter: string | null;
  localBalanceAfter: string | null;
  differenceCents: string | null;
  reason: TimelineParityMismatchReason;
};

export type FinancialEngineShadowReport = {
  matches: boolean;
  mismatches: TimelineParityMismatch[];
  accounts: number;
  rows: number;
  durationMs: number;
  orderMatches: boolean;
  payloadBytes: number;
  shadowBytes: number;
  skipped?: boolean;
};

export function isFinancialEngineShadowEnabled(
  raw: string | boolean | null | undefined
): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export function shadowRowId(row: ShadowTimelineRow): string {
  if (row.transaction_id != null) return `txn:${row.transaction_id}`;
  return `syn:${row.account_id}:${String(row.date).slice(0, 10)}:${row.rule_id ?? ""}:${row.amount}:${row.description ?? ""}`;
}

export function timelineRowToEngineInput(row: ShadowTimelineRow): EngineTimelineRowInput {
  return {
    account_id: row.account_id,
    date: String(row.date).slice(0, 10),
    amount: String(row.amount),
    type: row.type,
    status: row.status,
    source: row.source,
    txn_source: row.txn_source ?? null,
    description: row.description,
    transaction_id: row.transaction_id ?? null,
    rule_id: row.rule_id ?? null,
    import_match_status: row.import_match_status ?? null,
    plaid_transaction_id: row.plaid_transaction_id ?? null,
    financially_active: row.financially_active !== false,
  };
}

/** Rows the Phase 1 walk actually assigns `balance_after` on (Pending + Upcoming). */
export function isCanonicalWalkShadowRow(row: ShadowTimelineRow, today: string): boolean {
  const input = timelineRowToEngineInput(row);
  return isPendingExpectedTimelineRow(input, today) || isForecastTimelineRow(input, today);
}

function quantizeMaybe(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  try {
    const cents = dollarsToCents(value);
    const negative = cents < 0n;
    const abs = negative ? -cents : cents;
    const whole = abs / 100n;
    const frac = abs % 100n;
    const body = `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
    return negative ? `-${body}` : body;
  } catch {
    return String(value);
  }
}

function lastBalanceByAccount(rows: readonly { account_id: number; balance_after?: string | null }[]): Map<number, string | null> {
  const last = new Map<number, string | null>();
  for (const row of rows) {
    if (row.balance_after != null) last.set(row.account_id, quantizeMaybe(row.balance_after));
  }
  return last;
}

export function compareTimelineParity(
  serverRows: readonly ShadowTimelineRow[],
  localRows: readonly EngineTimelineRow[],
  options?: {
    accountSummary?: { account_id: number; ending_balance: string }[];
  }
): Pick<FinancialEngineShadowReport, "matches" | "mismatches" | "orderMatches"> {
  const mismatches: TimelineParityMismatch[] = [];
  const serverById = new Map(serverRows.map((row) => [shadowRowId(row), row]));
  const localById = new Map(localRows.map((row) => [shadowRowId(row), row]));

  for (const [id, server] of serverById) {
    const local = localById.get(id);
    if (!local) {
      mismatches.push({
        rowId: id,
        accountId: server.account_id,
        date: String(server.date).slice(0, 10),
        serverBalanceAfter: quantizeMaybe(server.balance_after),
        localBalanceAfter: null,
        differenceCents: null,
        reason: "missing_local",
      });
      continue;
    }
    const serverBal = quantizeMaybe(server.balance_after);
    const localBal = quantizeMaybe(local.balance_after);
    if (serverBal !== localBal) {
      let differenceCents: string | null = null;
      if (serverBal != null && localBal != null) {
        differenceCents = (dollarsToCents(localBal) - dollarsToCents(serverBal)).toString();
      }
      mismatches.push({
        rowId: id,
        accountId: server.account_id,
        date: String(server.date).slice(0, 10),
        serverBalanceAfter: serverBal,
        localBalanceAfter: localBal,
        differenceCents,
        reason: "balance",
      });
    }
  }

  for (const [id, local] of localById) {
    if (serverById.has(id)) continue;
    mismatches.push({
      rowId: id,
      accountId: local.account_id,
      date: String(local.date).slice(0, 10),
      serverBalanceAfter: null,
      localBalanceAfter: quantizeMaybe(local.balance_after),
      differenceCents: null,
      reason: "missing_server",
    });
  }

  const serverOrder = serverRows.map(shadowRowId);
  const localOrder = localRows.map(shadowRowId);
  const orderMatches =
    serverOrder.length === localOrder.length && serverOrder.every((id, i) => id === localOrder[i]);
  if (!orderMatches) {
    mismatches.push({
      rowId: localOrder[0] ?? serverOrder[0] ?? "order",
      accountId: serverRows[0]?.account_id ?? localRows[0]?.account_id ?? 0,
      date: String(serverRows[0]?.date ?? localRows[0]?.date ?? "").slice(0, 10),
      serverBalanceAfter: null,
      localBalanceAfter: null,
      differenceCents: null,
      reason: "order",
    });
  }

  const serverEnding = lastBalanceByAccount(serverRows);
  const localEnding = lastBalanceByAccount(localRows);
  const accountIds = new Set([...serverEnding.keys(), ...localEnding.keys()]);
  for (const summary of options?.accountSummary ?? []) {
    accountIds.add(summary.account_id);
  }
  for (const accountId of accountIds) {
    const serverBal = serverEnding.get(accountId) ?? null;
    const localBal = localEnding.get(accountId) ?? null;
    const summaryBal = quantizeMaybe(
      options?.accountSummary?.find((a) => a.account_id === accountId)?.ending_balance
    );
    const expected = serverBal ?? summaryBal;
    if (expected != null && localBal != null && expected !== localBal) {
      mismatches.push({
        rowId: `ending:${accountId}`,
        accountId,
        date: "",
        serverBalanceAfter: expected,
        localBalanceAfter: localBal,
        differenceCents: (dollarsToCents(localBal) - dollarsToCents(expected)).toString(),
        reason: "ending",
      });
    }
  }

  return {
    matches: mismatches.length === 0,
    mismatches,
    orderMatches,
  };
}

export function observeFinancialEngineShadow(options: {
  enabled: boolean;
  response: ShadowTimelineResponse;
  today?: string;
  now?: () => number;
  log?: (line: string, details?: unknown) => void;
  buildTimelineFn?: typeof buildTimeline;
}): FinancialEngineShadowReport | null {
  if (!options.enabled) return null;

  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const payloadBytes = jsonSize(options.response);
  const shadowBytes = jsonSize(options.response.engine_shadow ?? {});
  const shadow = options.response.engine_shadow;
  const rows = options.response.timeline ?? [];

  if (!shadow?.accounts?.length) {
    const report: FinancialEngineShadowReport = {
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
      payloadBytes,
      shadowBytes,
      skipped: true,
    };
    options.log?.(
      `[financial-engine-shadow] accounts=0 rows=${rows.length} duration_ms=0 mismatches=1 skipped=missing_anchors`,
      report
    );
    return report;
  }

  const accounts: EngineAccountSnapshot[] = shadow.accounts.map((account) => ({
    id: account.account_id,
    posted_balance_before_pending: String(account.posted_balance_before_pending),
  }));
  const engineRows = rows.map(timelineRowToEngineInput);
  const build = options.buildTimelineFn ?? buildTimeline;
  const t0 = now();
  const localRows = build({
    accounts,
    rows: engineRows,
    today: options.today || shadow.as_of,
  });
  const durationMs = Math.round((now() - t0) * 10) / 10;
  const today = options.today || shadow.as_of;
  const compared = compareTimelineParity(
    rows.filter((row) => isCanonicalWalkShadowRow(row, today)),
    localRows.filter((row) => isCanonicalWalkShadowRow(row, today)),
    {
      accountSummary: options.response.account_summary,
    }
  );
  const report: FinancialEngineShadowReport = {
    ...compared,
    accounts: accounts.length,
    rows: rows.length,
    durationMs,
    payloadBytes,
    shadowBytes,
  };
  const line = `[financial-engine-shadow] accounts=${report.accounts} rows=${report.rows} duration_ms=${report.durationMs} mismatches=${report.mismatches.length} payload_bytes=${payloadBytes} shadow_bytes=${shadowBytes}`;
  options.log?.(line, compared.matches ? undefined : report);
  return report;
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
