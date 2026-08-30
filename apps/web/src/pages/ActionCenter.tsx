import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardRecommendation } from "@budget-app/shared";
import { getRecommendations, listAccounts } from "@budget-app/api-client";
import { PAGE_SHELL } from "../lib/pageLayout";
import RecommendationsList, { SurvivalModeBanner } from "../components/dashboard/RecommendationsList";
import ResolveRiskModal from "../components/resolveRisk/ResolveRiskModal";
import QuickTransactionModal, {
  type QuickTransactionPreset,
} from "../components/quickActions/QuickTransactionModal";
import ActionToast from "../components/quickActions/ActionToast";
import ForecastWindowSelect from "../components/forecast/ForecastWindowSelect";
import LookingAheadBanner from "../components/dashboard/LookingAheadBanner";
import {
  ACTION_CENTER_PAGE_TITLE,
  dismissRecommendation,
  loadDismissedRecommendationIds,
  loadSnoozedRecommendationIds,
  recommendationTransferPreset,
  recommendationsEmptyMessage,
  recommendationsForActionCenter,
  restoreRecommendation,
  snoozeRecommendation,
  unsnoozeRecommendation,
} from "../lib/recommendationDisplay";
import { buildActionCenterView } from "../lib/actionCenterView";
import { usePageForecastWindow } from "../hooks/usePageForecastWindow";
import { useExtendedCashRisk } from "../hooks/useExtendedCashRisk";
import { usePerfPageLoad } from "../hooks/usePerfPageLoad";
import { isLookingAheadVisible } from "../lib/lookingAhead";

export default function ActionCenter() {
  const queryClient = useQueryClient();
  const { forecastDays, setForecastDays, ready: forecastReady } = usePageForecastWindow();
  const [refresh, setRefresh] = useState(0);
  const [txnPreset, setTxnPreset] = useState<QuickTransactionPreset | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resolveRiskAccountId, setResolveRiskAccountId] = useState<number | null>(null);
  const resolveRiskOpen = resolveRiskAccountId != null;
  const transferModalOpen = txnPreset != null;
  const needsAccountOptions = resolveRiskOpen || transferModalOpen;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["recommendations", "action-center", forecastDays],
    queryFn: () => getRecommendations({ days: forecastDays }),
    staleTime: 60_000,
    enabled: forecastReady,
  });

  const { data: extendedCashRisk } = useExtendedCashRisk(forecastReady && !!data);
  const lookingAhead = isLookingAheadVisible(extendedCashRisk, forecastDays);

  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "action-center"],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
    enabled: needsAccountOptions,
    staleTime: 60_000,
  });
  const accounts = accountsData?.results ?? [];

  const entries = useMemo(() => {
    void refresh;
    if (!data) return [];
    return recommendationsForActionCenter(
      data.recommendations,
      undefined,
      loadDismissedRecommendationIds(),
      loadSnoozedRecommendationIds()
    );
  }, [data, refresh]);

  const view = useMemo(
    () => buildActionCenterView(entries),
    [entries]
  );
  const snoozedCount = entries.filter((e) => e.displayState === "snoozed").length;
  const dismissedCount = entries.filter((e) => e.displayState === "dismissed").length;

  usePerfPageLoad("action-center", !isLoading && !isError);

  function bumpRefresh() {
    setRefresh((n) => n + 1);
  }

  async function invalidateFinancialQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["recommendations"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["extended-cash-risk"] }),
    ]);
  }

  return (
    <div className={`${PAGE_SHELL} py-4 space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{ACTION_CENTER_PAGE_TITLE}</h1>
          <p className="text-sm text-gray-600 mt-1">
            What requires my attention? Forecast-driven actions, grouped by urgency.
          </p>
        </div>
        <ForecastWindowSelect
          value={forecastDays}
          onChange={setForecastDays}
          disabled={!forecastReady}
          testId="action-center-forecast-window"
        />
      </div>

      {lookingAhead && <LookingAheadBanner risk={extendedCashRisk.risk} />}

      {(isLoading || !forecastReady) && (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-lg bg-gray-200" aria-hidden />
          ))}
        </div>
      )}

      {isError && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
          Could not load recommendations. Try refreshing the page.
        </div>
      )}

      {data && !isLoading && (
        <>
          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            <span className="font-medium text-gray-800">{view.summaryText}</span>
            {snoozedCount > 0 && (
              <span>
                <span className="font-semibold text-gray-900">{snoozedCount}</span> snoozed
              </span>
            )}
            {dismissedCount > 0 && (
              <span>
                <span className="font-semibold text-gray-900">{dismissedCount}</span> dismissed
              </span>
            )}
          </div>

          {view.survival && <SurvivalModeBanner entry={view.survival} />}

          {(view.groups.length > 0 || view.inactive.length > 0) && (
            <RecommendationsList
              groups={view.groups}
              inactive={view.inactive}
              emptyMessage={recommendationsEmptyMessage()}
              onExecuteTransfer={(rec: DashboardRecommendation) => {
                const preset = recommendationTransferPreset(rec);
                if (preset) setTxnPreset(preset);
              }}
              onResolveRisk={setResolveRiskAccountId}
              onDismiss={(id) => {
                dismissRecommendation(id);
                bumpRefresh();
              }}
              onSnooze={(id) => {
                snoozeRecommendation(id);
                bumpRefresh();
              }}
              onRestore={(id) => {
                restoreRecommendation(id);
                bumpRefresh();
              }}
              onUnsnooze={(id) => {
                unsnoozeRecommendation(id);
                bumpRefresh();
              }}
            />
          )}

          {view.groups.length === 0 && view.inactive.length === 0 && !view.survival && (
            <div className="rounded-lg border border-gray-200 bg-white p-2.5 text-sm text-gray-600">
              {recommendationsEmptyMessage()}
            </div>
          )}
        </>
      )}

      {resolveRiskAccountId != null && (
        <ResolveRiskModal
          open
          accountId={resolveRiskAccountId}
          accountName={
            accounts.find((a) => a.id === resolveRiskAccountId)?.effective_display_name ??
            "Account"
          }
          forecastDays={forecastDays}
          accounts={accounts}
          onClose={() => setResolveRiskAccountId(null)}
          onApplyTransfer={(preset) => {
            setTxnPreset(preset);
            setResolveRiskAccountId(null);
          }}
          onSnoozed={() => {
            bumpRefresh();
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
          await invalidateFinancialQueries();
          bumpRefresh();
        }}
      />
    </div>
  );
}
