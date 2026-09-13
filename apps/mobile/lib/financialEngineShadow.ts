import { getTimeline } from "@budget-app/api-client";
import { timedStartupQueryFn } from "@/lib/startupQueries";
import { recordTimelineBackendMeta } from "@/lib/startupTrace";
import {
  financialEngineTimelineRequestParams,
  parseFinancialEngineMode,
  resolveTimelineWithFinancialEngine,
  FinancialEngineUnusablePayloadError,
  type FinancialEngineMode,
  type TimelineResponse,
} from "@budget-app/shared";

export function getMobileFinancialEngineMode(): FinancialEngineMode {
  return parseFinancialEngineMode(
    process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_MODE,
    process.env.EXPO_PUBLIC_FINANCIAL_ENGINE_SHADOW
  );
}

export function isMobileFinancialEngineShadowEnabled(): boolean {
  return getMobileFinancialEngineMode() !== "server";
}

function resolveMode(options?: { mode?: FinancialEngineMode; enabled?: boolean }): FinancialEngineMode {
  if (options?.mode) return options.mode;
  if (options?.enabled === true) return "shadow";
  if (options?.enabled === false) return "server";
  return getMobileFinancialEngineMode();
}

function engineLog(line: string, details?: unknown): void {
  if (details) {
    // eslint-disable-next-line no-console
    console.warn(line, details);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(line);
}

/**
 * Timeline fetch with centralized financial-engine mode.
 * Calculates the local walk at most once per response. Server/shadow/fallback
 * return the Django payload object unchanged. Client-mode payloads that cannot
 * be walked (and have no server balances) throw so React Query can retry.
 */
export async function getTimelineWithEngineShadow(
  params: Parameters<typeof getTimeline>[0],
  options?: { mode?: FinancialEngineMode; enabled?: boolean }
): Promise<TimelineResponse> {
  const mode = resolveMode(options);
  const data = await timedStartupQueryFn("timeline", "network_fetch", () =>
    getTimeline({
      ...params,
      ...financialEngineTimelineRequestParams(mode),
    })
  );
  recordTimelineBackendMeta({
    balanceWalkMode: data.engine_shadow?.balance_walk_source ?? mode,
  });
  const resolved = resolveTimelineWithFinancialEngine({
    mode,
    response: data,
    today: params.as_of || data.engine_shadow?.as_of,
    log: engineLog,
  });
  if (resolved.source === "unusable") {
    throw new FinancialEngineUnusablePayloadError(resolved.diagnostics.reason);
  }
  if (resolved.source !== "client") return data;
  return {
    ...data,
    timeline: resolved.rows as TimelineResponse["timeline"],
    account_summary: (resolved.accountSummary ?? data.account_summary) as TimelineResponse["account_summary"],
  };
}
