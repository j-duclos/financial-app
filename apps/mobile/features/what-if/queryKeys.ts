import type { ForecastHorizon } from "./types";

/** Scenario queries are isolated from real financial data (dashboard, timeline, etc.). */
export const whatIfQueryKeys = {
  scenarios: ["what-if-scenarios"] as const,
  scenarioChanges: (scenarioId: number, householdId?: number | null) =>
    ["what-if-scenario-changes", householdId ?? null, scenarioId] as const,
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
  /** Balance-enriched accounts for debt forms only — not the shared account-options list. */
  accounts: (householdId?: number | null) =>
    ["what-if-accounts", householdId ?? null] as const,
};

/**
 * Deterministic stamp of scenario financial inputs (ids + updated_at only).
 * Does not include object identity, UI labels, or unrelated timestamps.
 */
export function scenarioInputStamp(parts: {
  scenarioUpdatedAt?: string;
  overrides?: Array<{ id: number; updated_at: string }>;
  events?: Array<{ id: number; updated_at: string }>;
  shocks?: Array<{ id: number; updated_at: string }>;
  addedRecurring?: Array<{ id: number; updated_at: string }>;
}): string {
  const sortStamp = (rows: Array<{ id: number; updated_at: string }> | undefined) =>
    [...(rows ?? [])]
      .sort((a, b) => a.id - b.id)
      .map((r) => `${r.id}:${r.updated_at}`)
      .join(",");

  return [
    parts.scenarioUpdatedAt ?? "",
    sortStamp(parts.overrides),
    sortStamp(parts.events),
    sortStamp(parts.shocks),
    sortStamp(parts.addedRecurring),
  ].join("|");
}
