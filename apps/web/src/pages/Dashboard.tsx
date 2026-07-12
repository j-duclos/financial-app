import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardSummaryFast, FinancialGoal } from "@budget-app/shared";
import { getDashboardDetails, getDashboardSummaryFast, listAccounts, listAllBuckets } from "@budget-app/api-client";
import { PAGE_SHELL } from "../lib/pageLayout";
import DashboardTopSummaryBar from "../components/dashboard/DashboardTopSummaryBar";
import DashboardSkeleton, { DashboardSectionSkeleton } from "../components/dashboard/DashboardSkeleton";
import { AttentionCardGrid } from "../components/dashboard/AttentionCard";
import { UpcomingMoneyFlowPreviewSection } from "../components/dashboard/UpcomingMoneyFlowPreview";
import GoalsPreviewSection, {
  GoalsPreviewSectionHeader,
} from "../components/dashboard/GoalsPreviewSection";
import QuickTransactionModal, {
  type QuickTransactionPreset,
} from "../components/quickActions/QuickTransactionModal";
import ActionToast from "../components/quickActions/ActionToast";
import { attentionTransferPreset } from "../lib/attentionCardDisplay";
import {
  DEFAULT_PASSIVE_FORECAST_DAYS,
  type ForecastDays,
} from "../lib/safeToSpendLabels";
import { UPCOMING_SECTION_TITLE } from "../lib/upcomingDisplay";
import { DASHBOARD_SECTION } from "../lib/dashboardTerminology";
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
  const needsAccounts = txnPreset != null;

  const { data: summaryFast, isLoading: fastLoading, isError: fastError } = useQuery({
    queryKey: ["dashboard-summary-fast", forecastDays],
    queryFn: () => getDashboardSummaryFast({ forecast_days: forecastDays }),
  });

  const [detailsEnabled, setDetailsEnabled] = useState(false);
  useEffect(() => {
    if (!summaryFast || fastError) {
      setDetailsEnabled(false);
      return;
    }
    setDetailsEnabled(false);
    const timer = window.setTimeout(() => setDetailsEnabled(true), 350);
    return () => window.clearTimeout(timer);
  }, [summaryFast, fastError, forecastDays]);

  const { data: details, isLoading: detailsLoading, isError: detailsError } = useQuery({
    queryKey: ["dashboard-summary-details", forecastDays],
    queryFn: () => getDashboardDetails({ forecast_days: forecastDays }),
    enabled: detailsEnabled,
  });

  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "dashboard"],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
    enabled: needsAccounts,
  });
  const accounts = accountsData?.results ?? [];

  const { data: allGoals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ["buckets", "all"],
    queryFn: () => listAllBuckets(),
    enabled: !!details && !(details.goals?.length),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const dashboardGoals = useMemo(() => {
    if (details?.goals?.length) return details.goals as FinancialGoal[];
    return allGoals;
  }, [details?.goals, allGoals]);
  const goalsPreviewLoading = goalsLoading && !(details?.goals?.length);
  const showOnboarding =
    summaryFast &&
    parseFloat(summaryFast.top_summary?.liquid_cash ?? "0") === 0 &&
    parseFloat(summaryFast.top_summary?.available_credit ?? "0") === 0 &&
    summaryFast.attention.length === 0 &&
    (summaryFast.recommendations?.length ?? summaryFast.insights.length) === 0;

  usePerfPageLoad("dashboard", !fastLoading && !fastError, { forecast_days: forecastDays });

  return (
    <div className={`${PAGE_SHELL} py-3 sm:py-4 space-y-3`}>
      <section aria-label={DASHBOARD_SECTION.financialHealth}>
        <DashboardTopSummaryBar
          summary={summaryFast}
          forecastDays={forecastDays}
          onForecastDaysChange={setForecastDays}
          loading={fastLoading}
        />
      </section>

      {fastLoading && <DashboardSkeleton omitHealth />}

      {fastError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
          <p className="font-medium">Could not load dashboard data.</p>
          <p className="mt-1">
            Manual accounts still work — add accounts and transactions to see forecasts and alerts.
          </p>
        </div>
      )}

      {summaryFast && (
        <>
          {showOnboarding && <DashboardOnboarding />}

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              Attention Required
            </h2>
            <AttentionCardGrid
              items={summaryFast.attention}
              windowDays={forecastDays}
              totalCount={summaryFast.attention_total_count}
              onMoveMoney={(item) => setTxnPreset(attentionTransferPreset(item))}
            />
          </section>

          {detailsError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Some dashboard sections could not load. Refresh to try again.
            </div>
          ) : (
            <>
              {!details || detailsLoading ? (
                <section aria-label={UPCOMING_SECTION_TITLE}>
                  <DashboardSectionSkeleton rows={2} />
                </section>
              ) : (
                <UpcomingMoneyFlowPreviewSection
                  groups={details.upcoming_groups ?? []}
                  nextIssue={
                    summaryFast.lowest_projected_cash
                      ? {
                          risk_date: summaryFast.lowest_projected_cash.date,
                          account_name: summaryFast.lowest_projected_cash.account_name,
                          reason: summaryFast.lowest_projected_cash.is_negative
                            ? "Projected balance drops below zero"
                            : undefined,
                        }
                      : null
                  }
                />
              )}

              {!details || detailsLoading ? (
                <section>
                  <GoalsPreviewSectionHeader />
                  <DashboardSectionSkeleton rows={2} />
                </section>
              ) : (
                <section aria-label="Goals Progress">
                  <GoalsPreviewSectionHeader />
                  <GoalsPreviewSection goals={dashboardGoals} loading={goalsPreviewLoading} />
                </section>
              )}
            </>
          )}

        </>
      )}

      <ActionToast message={toast} onDismiss={() => setToast(null)} />
      <QuickTransactionModal
        open={txnPreset != null}
        preset={txnPreset}
        accounts={accounts}
        onClose={() => setTxnPreset(null)}
        onSuccess={async (message) => {
          setToast(message);
          await queryClient.invalidateQueries({ queryKey: ["dashboard-summary-fast"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard-summary-details"] });
        }}
      />
    </div>
  );
}
