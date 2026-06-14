import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FinancialGoal } from "@budget-app/shared";
import { getDashboardSummary, listAccounts, listAllBuckets } from "@budget-app/api-client";
import { topActiveGoalsForDashboard } from "../lib/goalsDashboard";
import { PAGE_SHELL } from "../lib/pageLayout";
import DashboardTopSummaryBar from "../components/dashboard/DashboardTopSummaryBar";
import DashboardSkeleton from "../components/dashboard/DashboardSkeleton";
import { AttentionCardGrid } from "../components/dashboard/AttentionCard";
import RecommendationsSection from "../components/dashboard/RecommendationsSection";
import ResolveRiskModal from "../components/resolveRisk/ResolveRiskModal";
import type { DashboardAttentionItem } from "@budget-app/shared";
import UpcomingList from "../components/dashboard/UpcomingList";
import FinancialSnapshotCard from "../components/dashboard/FinancialSnapshotCard";
import GoalsProgressSection from "../components/dashboard/GoalsProgressSection";
import QuickTransactionModal, {
  type QuickTransactionPreset,
} from "../components/quickActions/QuickTransactionModal";
import ActionToast from "../components/quickActions/ActionToast";
import { attentionTransferPreset } from "../lib/attentionCardDisplay";
import { recommendationTransferPreset } from "../lib/recommendationDisplay";
import {
  DEFAULT_PASSIVE_FORECAST_DAYS,
  type ForecastDays,
} from "../lib/safeToSpendLabels";
import { DASHBOARD_SECTION } from "../lib/dashboardTerminology";
import {
  UPCOMING_SECTION_TITLE,
  upcomingSectionCollapsedSummary,
  upcomingSectionCollapseLabel,
} from "../lib/upcomingDisplay";
import { usePerfPageLoad } from "../hooks/usePerfPageLoad";

function DashboardOnboarding() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-700 space-y-2">
      <p className="font-medium text-gray-900">Get started with your financial command center</p>
      <ul className="list-disc list-inside text-xs space-y-1 text-gray-600">
        <li>
          <Link to="/accounts" className="text-blue-600 hover:underline">
            Connect or add your first account
          </Link>
        </li>
        <li>
          <Link to="/goals?new=1" className="text-blue-600 hover:underline">
            Create a savings goal
          </Link>
        </li>
        <li>
          <Link to="/transactions" className="text-blue-600 hover:underline">
            Add recurring bills and income
          </Link>
        </li>
      </ul>
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [forecastDays, setForecastDays] = useState<ForecastDays>(
    DEFAULT_PASSIVE_FORECAST_DAYS
  );
  const [txnPreset, setTxnPreset] = useState<QuickTransactionPreset | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [upcomingCollapsed, setUpcomingCollapsed] = useState(false);
  const [resolveRiskTarget, setResolveRiskTarget] = useState<DashboardAttentionItem | null>(
    null
  );
  const [resolveRiskAccountId, setResolveRiskAccountId] = useState<number | null>(null);

  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ["dashboard-summary", forecastDays],
    queryFn: () => getDashboardSummary({ forecast_days: forecastDays }),
  });

  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "dashboard"],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
  });
  const accounts = accountsData?.results ?? [];

  const { data: allGoals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ["buckets", "all"],
    queryFn: () => listAllBuckets(),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const dashboardGoals = useMemo(() => {
    if (summary?.goals?.length) return summary.goals as FinancialGoal[];
    return topActiveGoalsForDashboard(allGoals, 3);
  }, [summary?.goals, allGoals]);
  const showOnboarding =
    summary &&
    accounts.length === 0 &&
    summary.attention.length === 0 &&
    (summary.recommendations?.length ?? summary.insights.length) === 0;

  usePerfPageLoad("dashboard", !isLoading && !isError, { forecast_days: forecastDays });

  return (
    <div className={`${PAGE_SHELL} py-3 sm:py-4 space-y-3`}>
      <section aria-label={DASHBOARD_SECTION.financialHealth}>
        <DashboardTopSummaryBar
          summary={summary}
          forecastDays={forecastDays}
          onForecastDaysChange={setForecastDays}
          loading={isLoading}
        />
      </section>

      {isLoading && <DashboardSkeleton omitHealth />}

      {isError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
          <p className="font-medium">Could not load dashboard data.</p>
          <p className="mt-1">
            Manual accounts still work — add accounts and transactions to see forecasts and alerts.
          </p>
        </div>
      )}

      {summary && (
        <>
          {showOnboarding && <DashboardOnboarding />}

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              Attention Required
            </h2>
            <AttentionCardGrid
              items={summary.attention}
              windowDays={summary.safe_to_spend.window_days}
              totalCount={summary.attention_total_count}
              onMoveMoney={(item) => setTxnPreset(attentionTransferPreset(item))}
              onResolveRisk={setResolveRiskTarget}
            />
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              Recommendations
            </h2>
            <RecommendationsSection
              summary={summary}
              onExecuteTransfer={(rec) => {
                const preset = recommendationTransferPreset(rec);
                if (preset) setTxnPreset(preset);
              }}
              onResolveRisk={(accountId) => setResolveRiskAccountId(accountId)}
            />
          </section>

          <section aria-label={UPCOMING_SECTION_TITLE}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <button
                type="button"
                onClick={() => setUpcomingCollapsed((v) => !v)}
                aria-expanded={!upcomingCollapsed}
                className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700"
              >
                {upcomingCollapsed ? (
                  <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <ChevronUp className="h-4 w-4 shrink-0" aria-hidden />
                )}
                {UPCOMING_SECTION_TITLE}
                <span className="sr-only">{upcomingSectionCollapseLabel(upcomingCollapsed)}</span>
              </button>
              {upcomingCollapsed && (
                <p className="text-xs text-gray-500">
                  {upcomingSectionCollapsedSummary(
                    summary.upcoming_groups ?? [],
                    summary.upcoming_days
                  )}
                </p>
              )}
            </div>
            {!upcomingCollapsed && (
              <UpcomingList
                groups={summary.upcoming_groups ?? []}
                days={summary.upcoming_days}
                truncated={summary.upcoming_truncated}
              />
            )}
          </section>

          <section aria-label={DASHBOARD_SECTION.resourceBreakdown} className="pt-1">
            <h2 className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
              {DASHBOARD_SECTION.resourceBreakdown}
            </h2>
            <FinancialSnapshotCard snapshot={summary.snapshot} />
          </section>

          <section>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Goals &amp; Progress
              </h2>
              <div className="flex items-center gap-3 shrink-0 text-xs">
                <Link to="/goals?new=1" className="text-blue-600 hover:underline">
                  Add goal
                </Link>
                <Link to="/goals" className="text-blue-600 hover:underline">
                  View goals
                </Link>
              </div>
            </div>
            <GoalsProgressSection
              goals={dashboardGoals}
              goalsLoading={goalsLoading}
              goalsSummary={summary.goals_summary}
              warnings={summary.goal_warnings ?? []}
            />
          </section>

        </>
      )}

      {(resolveRiskTarget || resolveRiskAccountId != null) && (
        <ResolveRiskModal
          open
          accountId={resolveRiskTarget?.account_id ?? resolveRiskAccountId!}
          accountName={
            resolveRiskTarget?.account_name ??
            accounts.find((a) => a.id === resolveRiskAccountId)?.effective_display_name ??
            "Account"
          }
          forecastDays={forecastDays}
          accounts={accounts}
          onClose={() => {
            setResolveRiskTarget(null);
            setResolveRiskAccountId(null);
          }}
          onApplyTransfer={(preset) => {
            setTxnPreset(preset);
            setResolveRiskTarget(null);
            setResolveRiskAccountId(null);
          }}
          onSnoozed={() => {
            void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
          }}
        />
      )}
      <ActionToast message={toast} onDismiss={() => setToast(null)} />
      <QuickTransactionModal
        open={txnPreset != null}
        preset={txnPreset}
        accounts={accounts}
        onClose={() => setTxnPreset(null)}
        onSuccess={async (message) => {
          setToast(message);
          await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
        }}
      />
    </div>
  );
}
