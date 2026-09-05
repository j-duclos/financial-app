import { useQuery } from "@tanstack/react-query";
import { fetchScenarioGuidedStrategyOrNull } from "../lib/guidedStrategyQuery";
import { whatIfWebQueryKeys } from "../lib/whatIfQueryKeys";

export function useScenarioGuidedStrategy(scenarioId: number | "") {
  return useQuery({
    queryKey: whatIfWebQueryKeys.guidedStrategy(scenarioId),
    queryFn: () => fetchScenarioGuidedStrategyOrNull(scenarioId as number),
    enabled: typeof scenarioId === "number" && scenarioId > 0,
  });
}
