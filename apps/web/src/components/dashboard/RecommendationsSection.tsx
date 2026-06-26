import { useMemo, useState } from "react";
import type { DashboardSummary, DashboardRecommendation } from "@budget-app/shared";
import RecommendationsList from "./RecommendationsList";
import {
  dismissRecommendation,
  loadDismissedRecommendationIds,
  loadSnoozedRecommendationIds,
  recommendationsForDisplay,
  recommendationsEmptyMessage,
  snoozeRecommendation,
} from "../../lib/recommendationDisplay";

/** @deprecated Use RecommendationsPreviewSection on Dashboard or RecommendationsList on Action Center. */
export default function RecommendationsSection({
  summary,
  onExecuteTransfer,
  onResolveRisk,
}: {
  summary: DashboardSummary;
  onExecuteTransfer?: (rec: DashboardRecommendation) => void;
  onResolveRisk?: (accountId: number) => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const entries = useMemo(() => {
    void refresh;
    const dismissed = loadDismissedRecommendationIds();
    const snoozed = loadSnoozedRecommendationIds();
    return recommendationsForDisplay(
      summary.recommendations,
      summary.insights,
      dismissed,
      snoozed
    ).map((rec) => ({ rec, displayState: "active" as const }));
  }, [summary.recommendations, summary.insights, refresh]);

  return (
    <RecommendationsList
      entries={entries}
      emptyMessage={recommendationsEmptyMessage()}
      onExecuteTransfer={onExecuteTransfer}
      onResolveRisk={onResolveRisk}
      onDismiss={(id) => {
        dismissRecommendation(id);
        setRefresh((n) => n + 1);
      }}
      onSnooze={(id) => {
        snoozeRecommendation(id);
        setRefresh((n) => n + 1);
      }}
    />
  );
}

export { RecommendationCard } from "./RecommendationsList";
