import { formatCurrency } from "@budget-app/shared";
import type { DashboardDebtSummary, DashboardSummaryFast } from "@budget-app/shared";
import { DASHBOARD_SECTION, FINANCIAL_HEALTH } from "../../lib/dashboardTerminology";
import {
  FORECAST_DAY_OPTIONS,
  type ForecastDays,
} from "../../lib/safeToSpendLabels";
import {
  availableCreditSubtitle,
  riskStatusClass,
  riskStatusLabel,
  safeToSpendAmountClass,
  safeToSpendHealthySubtitle,
  safeToSpendRiskSubtitle,
  topSummaryFromDashboard,
} from "../../lib/topSummaryDisplay";
import DashboardMetricTile from "./DashboardMetricTile";
import DebtPayoffInsight from "./DebtPayoffInsight";
import { METRIC_TILE_GRID_5, METRIC_TILE_SKELETON_CLASS } from "./metricTileLayout";

type Props = {
  summary: DashboardSummaryFast | undefined;
  forecastDays: ForecastDays;
  onForecastDaysChange: (days: ForecastDays) => void;
  loading?: boolean;
};

function healthSkeletonCount(debt?: DashboardDebtSummary | null) {
  const hasDebt = debt?.total_debt && parseFloat(debt.total_debt) > 0;
  return hasDebt ? 5 : 4;
}

function ForecastWindowControl({
  forecastDays,
  onForecastDaysChange,
}: {
  forecastDays: ForecastDays;
  onForecastDaysChange: (days: ForecastDays) => void;
}) {
  return (
    <label className="flex items-center gap-2 shrink-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Forecast window
      </span>
      <select
        value={forecastDays}
        onChange={(e) => onForecastDaysChange(Number(e.target.value) as ForecastDays)}
        className="rounded border border-gray-300 bg-white px-2 py-1.5 text-xs sm:text-sm"
        data-testid="forecast-window-select"
      >
        {FORECAST_DAY_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {d} days
          </option>
        ))}
      </select>
    </label>
  );
}

export default function DashboardTopSummaryBar({
  summary,
  forecastDays,
  onForecastDaysChange,
  loading = false,
}: Props) {
  const top = summary ? topSummaryFromDashboard(summary) : null;
  const sts = summary?.safe_to_spend;
  const debt = summary?.debt;
  const riskSub = sts ? safeToSpendRiskSubtitle(sts) : null;
  const net = top ? parseFloat(top.net_position) : 0;
  const skeletonCount = healthSkeletonCount(debt);
  const hasDebt = debt?.total_debt && parseFloat(debt.total_debt) > 0;
  const gridClass = hasDebt ? METRIC_TILE_GRID_5 : "grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-2";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          {DASHBOARD_SECTION.financialHealth}
        </h2>
        <ForecastWindowControl
          forecastDays={forecastDays}
          onForecastDaysChange={onForecastDaysChange}
        />
      </div>
      <div className={gridClass}>
        {loading || !sts ? (
          Array.from({ length: skeletonCount }).map((_, i) => (
            <div
              key={i}
              className={`${METRIC_TILE_SKELETON_CLASS} ${i === 0 ? "rounded-xl border-2 border-blue-200 ring-1 ring-blue-100/80" : ""}`}
              aria-hidden
            />
          ))
        ) : (
          <>
            <DashboardMetricTile
              label={FINANCIAL_HEALTH.safeToSpend.label}
              value={formatCurrency(sts.amount)}
              valueClassName={safeToSpendAmountClass(sts)}
              help={FINANCIAL_HEALTH.safeToSpend.help}
              hero
              subtitle={
                riskSub ? (
                  <span className="font-medium text-red-700">{riskSub}</span>
                ) : (
                  <span className="text-gray-600">{safeToSpendHealthySubtitle(sts.window_days)}</span>
                )
              }
              badge={
                sts.status !== "healthy" ? (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] sm:text-[9px] font-semibold uppercase ${riskStatusClass(sts.status)}`}
                  >
                    {riskStatusLabel(sts.status)}
                  </span>
                ) : null
              }
            />
            <DashboardMetricTile
              label={FINANCIAL_HEALTH.availableCash.label}
              value={formatCurrency(top!.liquid_cash)}
              help={FINANCIAL_HEALTH.availableCash.help}
              subtitle={
                <span className="text-gray-500">{FINANCIAL_HEALTH.availableCash.subtitle}</span>
              }
            />
            <DashboardMetricTile
              label={FINANCIAL_HEALTH.availableCredit.label}
              value={formatCurrency(top!.available_credit)}
              help={FINANCIAL_HEALTH.availableCredit.help}
              subtitle={
                <span className="text-gray-500">
                  {availableCreditSubtitle(top!.credit_utilization, top!.total_credit_limit)}
                </span>
              }
            />
            <DashboardMetricTile
              label={FINANCIAL_HEALTH.cashAfterDebt.label}
              value={formatCurrency(top!.net_position)}
              valueClassName={net >= 0 ? "text-gray-900" : "text-red-700"}
              help={FINANCIAL_HEALTH.cashAfterDebt.help}
              subtitle={
                <span className="text-gray-500">{FINANCIAL_HEALTH.cashAfterDebt.subtitle}</span>
              }
            />
            {debt ? <DebtPayoffInsight debt={debt} grid /> : null}
          </>
        )}
      </div>
    </div>
  );
}
