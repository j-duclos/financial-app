/**
 * Web What-If query keys — scenario-scoped only.
 * Real financial caches (dashboard, transactions, calendar, goals, rules, accounts)
 * must never be invalidated by scenario mutations.
 */
export const whatIfWebQueryKeys = {
  scenarios: ["scenarios"] as const,
  scenarioChanges: (scenarioId: number | "", householdId?: number | null) =>
    ["scenario-changes", householdId ?? null, scenarioId] as const,
  compare: (
    scenarioId: number | "",
    horizon: string,
    householdId: number | undefined | "",
    financialRevision: number | undefined,
    inputStamp: string
  ) =>
    ["scenario-compare", scenarioId, horizon, householdId, financialRevision, inputStamp] as const,
};

/** Deterministic stamp of scenario financial inputs (ids + updated_at only). */
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
