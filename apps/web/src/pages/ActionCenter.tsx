import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardRecommendation } from "@budget-app/shared";
import { getDashboardSummary, listAccounts } from "@budget-app/api-client";
import { PAGE_SHELL } from "../lib/pageLayout";
import RecommendationsList from "../components/dashboard/RecommendationsList";
import ResolveRiskModal from "../components/resolveRisk/ResolveRiskModal";
import QuickTransactionModal, {
  type QuickTransactionPreset,
} from "../components/quickActions/QuickTransactionModal";
import ActionToast from "../components/quickActions/ActionToast";
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
import { DEFAULT_PASSIVE_FORECAST_DAYS } from "../lib/safeToSpendLabels";
import { usePerfPageLoad } from "../hooks/usePerfPageLoad";

export default function ActionCenter() {
  const queryClient = useQueryClient();
  const [refresh, setRefresh] = useState(0);
  const [txnPreset, setTxnPreset] = useState<QuickTransactionPreset | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [resolveRiskAccountId, setResolveRiskAccountId] = useState<number | null>(null);

  const { data: summary, isLoading, isError } = useQuery({
    queryKey: ["dashboard-summary", "action-center", DEFAULT_PASSIVE_FORECAST_DAYS],
    queryFn: () => getDashboardSummary({ forecast_days: DEFAULT_PASSIVE_FORECAST_DAYS }),
    staleTime: 60_000,
  });

  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "action-center"],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
  });
  const accounts = accountsData?.results ?? [];

  const entries = useMemo(() => {
    void refresh;
    if (!summary) return [];
    return recommendationsForActionCenter(
      summary.recommendations,
      summary.insights,
      loadDismissedRecommendationIds(),
      loadSnoozedRecommendationIds()
    );
  }, [summary, refresh]);

  const activeCount = entries.filter((e) => e.displayState === "active").length;
  const snoozedCount = entries.filter((e) => e.displayState === "snoozed").length;
  const dismissedCount = entries.filter((e) => e.displayState === "dismissed").length;

  usePerfPageLoad("action-center", !isLoading && !isError);

  function bumpRefresh() {
    setRefresh((n) => n + 1);
  }

  return (
    <div className={`${PAGE_SHELL} py-4 space-y-4`}>
      <div>
        <h1 className="text-lg font-semibold text-gray-900">{ACTION_CENTER_PAGE_TITLE}</h1>
        <p className="text-sm text-gray-600 mt-1">
          Review forecast-driven actions by urgency — critical and at-risk items first.
        </p>
      </div>

      {isLoading && (
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

      {summary && !isLoading && (
        <>
          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            <span>
              <span className="font-semibold text-gray-900">{activeCount}</span> active
            </span>
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

          <RecommendationsList
            entries={entries}
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
          forecastDays={DEFAULT_PASSIVE_FORECAST_DAYS}
          accounts={accounts}
          onClose={() => setResolveRiskAccountId(null)}
          onApplyTransfer={(preset) => {
            setTxnPreset(preset);
            setResolveRiskAccountId(null);
          }}
          onSnoozed={() => {
            void queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
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
          await queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
          bumpRefresh();
        }}
      />
    </div>
  );
}
