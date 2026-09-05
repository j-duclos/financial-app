import { ApiError, getScenarioGuidedStrategy } from "@budget-app/api-client";
import type { ScenarioGuidedStrategy } from "@budget-app/shared";

export function isGuidedStrategyNotConfiguredError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** GET 404 means no guided strategy is saved — a valid empty state, not a page error. */
export async function fetchScenarioGuidedStrategyOrNull(
  scenarioId: number
): Promise<ScenarioGuidedStrategy | null> {
  try {
    return await getScenarioGuidedStrategy(scenarioId);
  } catch (error) {
    if (isGuidedStrategyNotConfiguredError(error)) return null;
    throw error;
  }
}
