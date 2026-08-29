import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EXTENDED_CASH_RISK_QUERY_KEY,
  isDashboardOnboarding,
  type FinancialGoal,
} from "@budget-app/shared";
import { getDashboardDetails, getDashboardSummaryFast, listAccounts } from "@budget-app/api-client";
import { PAGE_SHELL } from "../lib/pageLayout";
import DashboardTopSummaryBar from "../components/dashboard/DashboardTopSummaryBar";
import DashboardSkeleton, { DashboardSectionSkeleton } from "../components/dashboard/DashboardSkeleton";
import { AttentionCardGrid } from "../components/dashboard/AttentionCard";
import LookingAheadBanner from "../components/dashboard/LookingAheadBanner";
import { UpcomingMoneyFlowPreviewSection } from "../components/dashboard/UpcomingMoneyFlowPreview";
import GoalsPreviewSection, {
  GoalsPreviewSectionHeader,
} from "../components/dashboard/GoalsPreviewSection";
import QuickTransactionModal, {
  type QuickTransactionPreset,
} from "../components/quickActions/QuickTransactionModal";
import ActionToast from "../components/quickActions/ActionToast";
import { attentionTransferPreset } from "../lib/attentionCardDisplay";
import { UPCOMING_SECTION_TITLE } from "../lib/upcomingDisplay";
import { DASHBOARD_SECTION } from "../lib/dashboardTerminology";
import { usePageForecastWindow } from "../hooks/usePageForecastWindow";
import { useExtendedCashRisk } from "../hooks/useExtendedCashRisk";
import { usePerfPageLoad } from "../hooks/usePerfPageLoad";
import { isLookingAheadVisible } from "../lib/lookingAhead";

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

/** Defer non-critical work until the browser is idle (or next tick as fallback). */
function runWhenIdle(task: () => void): () => void {
  const idle = typeof window !== "undefined" ? window.requestIdleCallback : undefined;
  if (typeof idle === "function") {
    const id = idle(() => task(), { timeout: 2000 });
    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(id);
      }
    };
  }
  const timeoutId = window.setTimeout(task, 0);
  return () => window.clearTimeout(timeoutId);
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { forecastDays, setForecastDays, ready: forecastReady } = usePageForecastWindow();
  const [txnPreset, setTxnPreset] = useState<QuickTransactionPreset | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [extendedRiskEnabled, setExtendedRiskEnabled] = useState(false);
  const needsAccounts = txnPreset != null;

  const {
    data: summaryFast,
    isLoading: fastLoading,
    isError: fastError,
    isSuccess: fastSuccess,
  } = useQuery({
    queryKey: ["dashboard-summary-fast", forecastDays],
    queryFn: () => getDashboardSummaryFast({ forecast_days: forecastDays }),
    enabled: forecastReady,
  });

  // Details starts immediately after summary-fast succeeds (no artificial delay).
  const detailsEnabled = forecastReady && fastSuccess && !fastError;

  const { data: details, isLoading: detailsLoading, isError: detailsError } = useQuery({
    queryKey: ["dashboard-summary-details", forecastDays],
    queryFn: () => getDashboardDetails({ forecast_days: forecastDays }),
    enabled: detailsEnabled,
  });

  const detailsSettled =
    detailsEnabled && ((!detailsLoading && !!details) || detailsError);

  // Extended risk is secondary — defer until details settled (or use cache immediately).
  useEffect(() => {
    if (!detailsSettled) {
      setExtendedRiskEnabled(false);
      return;
    }
    if (queryClient.getQueryData(EXTENDED_CASH_RISK_QUERY_KEY) != null) {
      setExtendedRiskEnabled(true);
      return;
    }
    return runWhenIdle(() => setExtendedRiskEnabled(true));
  }, [detailsSettled, queryClient, forecastDays]);

  const { data: extendedCashRisk } = useExtendedCashRisk(extendedRiskEnabled);
  const lookingAhead = isLookingAheadVisible(extendedCashRisk, forecastDays);

  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "dashboard"],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
    enabled: needsAccounts,
  });
  const accounts = accountsData?.results ?? [];

  const dashboardGoals = useMemo(
    () => (details?.goals ?? []) as FinancialGoal[],
    [details?.goals]
  );

  const showOnboarding = isDashboardOnboarding(summaryFast);

  usePerfPageLoad("dashboard", !fastLoading && !fastError, { forecast_days: forecastDays });

  return (
    <div className={`${PAGE_SHELL} py-3 sm:py-4 space-y-3`}>
      <section aria-label={DASHBOARD_SECTION.financialHealth}>
        <DashboardTopSummaryBar
          summary={summaryFast}
          forecastDays={forecastDays}
          onForecastDaysChange={setForecastDays}
          loading={fastLoading || !forecastReady}
        />
      </section>

      {(fastLoading || !forecastReady) && <DashboardSkeleton omitHealth />}

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

          {lookingAhead && <LookingAheadBanner risk={extendedCashRisk.risk} />}

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
                    summaryFast.first_cash_shortfall
                      ? {
                          risk_date: summaryFast.first_cash_shortfall.date,
                          account_name: summaryFast.first_cash_shortfall.account_name ?? undefined,
                          reason: "Projected balance drops below zero",
                          projected_balance: summaryFast.first_cash_shortfall.amount,
                          first_negative_transaction_id:
                            summaryFast.first_cash_shortfall.first_negative_transaction_id ?? null,
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
                  <GoalsPreviewSection goals={dashboardGoals} loading={false} />
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
          await queryClient.invalidateQueries({ queryKey: EXTENDED_CASH_RISK_QUERY_KEY });
        }}
      />
    </div>
  );
}
