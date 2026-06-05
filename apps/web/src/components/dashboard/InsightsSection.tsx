import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import type { DashboardInsight } from "@budget-app/shared";
import {
  insightActionLabel,
  insightActionState,
  insightSeverityIconClass,
  insightSeverityLabel,
  insightsEmptyMessage,
  insightsEmptySubtext,
} from "../../lib/insightDisplay";

function InsightRow({ insight }: { insight: DashboardInsight }) {
  const navState = insightActionState(insight.action_url);

  return (
    <article className="flex gap-2 p-2.5 rounded-lg border border-gray-200 bg-white hover:border-gray-300 transition-colors">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${insightSeverityIconClass(insight.severity)}`}
        aria-hidden
      >
        {insightSeverityLabel(insight.severity)}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-gray-900">{insight.title}</h3>
        <p className="text-sm text-gray-600 mt-0.5">{insight.message}</p>
        {insight.metric_label && insight.metric_value && (
          <p className="text-xs text-gray-500 mt-1">
            {insight.metric_label}:{" "}
            <span className="font-medium text-gray-800">
              {insight.metric_label.toLowerCase().includes("amount") ||
              insight.metric_label.toLowerCase().includes("net") ||
              insight.metric_label.toLowerCase().includes("shortfall")
                ? formatCurrency(insight.metric_value)
                : insight.metric_value}
            </span>
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-1.5">
          {insight.action_label && insight.action_url && (
            <Link
              to={insight.action_url}
              state={navState}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              {insightActionLabel(insight.action_label)}
            </Link>
          )}
          {insight.secondary_action_label && insight.secondary_action_url && (
            <Link
              to={insight.secondary_action_url}
              state={insightActionState(insight.secondary_action_url)}
              className="text-xs font-medium text-gray-600 hover:underline"
            >
              {insightActionLabel(insight.secondary_action_label)}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export default function InsightsSection({ insights }: { insights: DashboardInsight[] }) {
  if (insights.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-3 text-sm text-gray-600">
        <p>{insightsEmptyMessage()}</p>
        <p className="text-xs text-gray-500 mt-1">{insightsEmptySubtext()}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
      {insights.map((insight) => (
        <InsightRow key={insight.id} insight={insight} />
      ))}
    </div>
  );
}
