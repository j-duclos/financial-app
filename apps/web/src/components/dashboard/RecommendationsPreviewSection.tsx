import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DashboardRecommendation, DashboardSummaryFast } from "@budget-app/shared";
import RecommendationsList from "./RecommendationsList";
import {
  ACTION_CENTER_PATH,
  DASHBOARD_RECOMMENDATION_PREVIEW_LIMIT,
  RECOMMENDATIONS_SECTION_TITLE,
  dashboardTopActionsFooterLabel,
  dashboardViewAllActionsLinkLabel,
  recommendationsForDashboardPreview,
  recommendationsPreviewEmptyMessage,
  recommendationsForActionCenter,
  dismissRecommendation,
  loadDismissedRecommendationIds,
  loadSnoozedRecommendationIds,
  snoozeRecommendation,
} from "../../lib/recommendationDisplay";

type Props = {
  summary: Pick<DashboardSummaryFast, "recommendations" | "insights">;
  onExecuteTransfer?: (rec: DashboardRecommendation) => void;
  onResolveRisk?: (accountId: number) => void;
};

/** Dashboard preview — top 2–3 active recommendations with link to Action Center. */
export default function RecommendationsPreviewSection({
  summary,
  onExecuteTransfer,
  onResolveRisk,
}: Props) {
  const [refresh, setRefresh] = useState(0);

  const entries = useMemo(() => {
    void refresh;
    const dismissed = loadDismissedRecommendationIds();
    const snoozed = loadSnoozedRecommendationIds();
    return recommendationsForDashboardPreview(
      summary.recommendations,
      summary.insights,
      dismissed,
      snoozed
    ).map((rec) => ({ rec, displayState: "active" as const }));
  }, [summary.recommendations, summary.insights, refresh]);

  const hasMore = useMemo(() => {
    const dismissed = loadDismissedRecommendationIds();
    const snoozed = loadSnoozedRecommendationIds();
    const activeTotal = recommendationsForActionCenter(
      summary.recommendations,
      summary.insights,
      dismissed,
      snoozed
    ).filter((e) => e.displayState === "active").length;
    return activeTotal > DASHBOARD_RECOMMENDATION_PREVIEW_LIMIT;
  }, [summary.recommendations, summary.insights]);

  return (
    <section aria-label={RECOMMENDATIONS_SECTION_TITLE}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {RECOMMENDATIONS_SECTION_TITLE}
        </h2>
      </div>
      <RecommendationsList
        entries={entries}
        emptyMessage={recommendationsPreviewEmptyMessage()}
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
      {hasMore && entries.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-xs text-gray-500">
          <span>{dashboardTopActionsFooterLabel()}</span>
          <Link to={ACTION_CENTER_PATH} className="font-medium text-blue-600 hover:underline">
            {dashboardViewAllActionsLinkLabel()}
          </Link>
        </div>
      )}
    </section>
  );
}
