import type { ForecastHorizon } from "./types";

/** Scenario queries are isolated from real financial data (dashboard, timeline, etc.). */
export const whatIfQueryKeys = {
  scenarios: ["what-if-scenarios"] as const,
  scenarioOverrides: (scenarioId: number) => ["what-if-scenario-overrides", scenarioId] as const,
  scenarioEvents: (scenarioId: number) => ["what-if-scenario-events", scenarioId] as const,
  scenarioShocks: (scenarioId: number) => ["what-if-scenario-shocks", scenarioId] as const,
  scenarioAddedRecurring: (scenarioId: number) =>
    ["what-if-scenario-added-recurring", scenarioId] as const,
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
  rules: ["what-if-rules"] as const,
  accounts: ["what-if-accounts"] as const,
  profile: ["what-if-profile"] as const,
  households: ["what-if-households"] as const,
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
