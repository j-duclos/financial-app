import type { ForecastHorizon } from "./types";

/** Scenario queries are isolated from real financial data (dashboard, timeline, etc.). */
export const whatIfQueryKeys = {
  scenarios: ["what-if-scenarios"] as const,
  scenarioChanges: (scenarioId: number) => ["what-if-scenario-changes", scenarioId] as const,
  compare: (
    scenarioId: number,
    horizon: ForecastHorizon,
    householdId: number | undefined,
    financialRevision: number | undefined,
    inputStamp: string
  ) =>
    [
      "what-if-scenario-compare",
      scenarioId,
      horizon,
      householdId,
      financialRevision,
      inputStamp,
    ] as const,
  /** What-If needs balances for debt/affordability forms — not the lightweight account-options list. */
  accounts: ["what-if-accounts"] as const,
};

export function scenarioInputStamp(parts: {
  scenarioUpdatedAt?: string;
  overrides?: Array<{ id: number; updated_at: string }>;
  events?: Array<{ id: number; updated_at: string }>;
  shocks?: Array<{ id: number; updated_at: string }>;
  addedRecurring?: Array<{ id: number; updated_at: string }>;
}): string {
  return [
    parts.scenarioUpdatedAt,
    (parts.overrides ?? []).map((o) => `${o.id}:${o.updated_at}`).join(","),
    (parts.events ?? []).map((e) => `${e.id}:${e.updated_at}`).join(","),
    (parts.shocks ?? []).map((s) => `${s.id}:${s.updated_at}`).join(","),
    (parts.addedRecurring ?? []).map((r) => `${r.id}:${r.updated_at}`).join(","),
  ].join("|");
}
