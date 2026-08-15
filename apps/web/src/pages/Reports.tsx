import { useMemo, useState, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, currentMonthStr } from "@budget-app/shared";
import type {
  CategoryBreakdownItem,
  CreditCardInterestReport,
  FinancialGoal,
  GoalsReport,
  MonthComparisonMetric,
  MonthlyReports,
  SpendingTargetMetrics,
} from "@budget-app/shared";
import { getMonthlyReports } from "@budget-app/api-client";
import {
  SPENDING_TARGET_STATUS_LABELS,
  spendingTargetProgressPercent,
  spendingTargetStatusClass,
} from "../lib/spendingTargetDisplay";
import { formatProjectedCompletion } from "../lib/goalDisplay";
import { partitionCategoryBreakdown } from "../lib/categoryBreakdownDisplay";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import { METRIC_TILE_GRID_2, METRIC_TILE_GRID_3 } from "../components/dashboard/metricTileLayout";
import { PAGE_SHELL_PY_LOOSE } from "../lib/pageLayout";
import {
  CategorySpendBarChart,
  GoalFundingChart,
  IncomeExpenseTrendChart,
  InterestTrendChart,
} from "../components/reports/ReportCharts";
import {
  deltaClassName,
  formatDeltaVsPrevious,
  formatMonthLabel,
  formatPercentChange,
  formatSignedAmount,
  parseAmount,
  parseReportViewParam,
  REPORT_TABS,
  shouldShowCategoryDelta,
  type ReportTab,
} from "../lib/reportDisplay";
import { SPENDING_GOALS_PATH } from "../lib/spendingTargetDisplay";
const TOP_CATEGORY_LIMIT = 8;

function comparisonSubtitle(
  metric: MonthComparisonMetric | undefined,
  previousMonth: string | undefined
) {
  if (!metric || !previousMonth) return undefined;
  const pct = formatPercentChange(metric.percent_change);
  const vs = formatDeltaVsPrevious(metric.delta, previousMonth);
  return pct ? `${vs} (${pct})` : vs;
}

function ComparisonLine({
  delta,
  previousMonth,
}: {
  delta?: string;
  previousMonth?: string;
}) {
  if (!delta || !previousMonth) return <span className="text-gray-400">—</span>;
  return (
    <span className={`tabular-nums ${deltaClassName(delta)}`}>
      {formatDeltaVsPrevious(delta, previousMonth)}
    </span>
  );
}

function CategoryTable({
  breakdown,
  previousMonth,
  showAll,
  onToggleShowAll,
}: {
  breakdown: CategoryBreakdownItem[];
  previousMonth?: string;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const partitioned = useMemo(() => partitionCategoryBreakdown(breakdown), [breakdown]);
  const expenseAbs = Math.abs(partitioned.expenseSubtotal);
  const visibleExpenses = showAll
    ? partitioned.expenses
    : [...partitioned.expenses]
        .sort((a, b) => parseAmount(a.total) - parseAmount(b.total))
        .slice(0, TOP_CATEGORY_LIMIT);
  const hiddenCount = partitioned.expenses.length - visibleExpenses.length;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-gray-700">Category</th>
            <th className="px-4 py-2 text-right font-medium text-gray-700">Amount</th>
            <th className="px-4 py-2 text-right font-medium text-gray-700 hidden sm:table-cell">
              Share
            </th>
            <th className="px-4 py-2 text-right font-medium text-gray-700">
              vs {previousMonth ? formatMonthLabel(previousMonth).split(" ")[0] : "prior"}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          <tr className="bg-gray-50">
            <td colSpan={4} className="px-4 py-2 text-sm font-semibold text-gray-700">
              Income
            </td>
          </tr>
          {partitioned.income.map((row) => (
            <tr key={row.category_id ?? "uncategorized-income"}>
              <td className="px-4 py-2 pl-6">
                {row.category_id != null ? (
                  <Link
                    to={`/transactions?category=${row.category_id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {row.category_name}
                  </Link>
                ) : (
                  row.category_name
                )}
              </td>
              <td className="px-4 py-2 text-right text-emerald-700 tabular-nums">
                {formatSignedAmount(row.total)}
              </td>
              <td className="px-4 py-2 text-right text-gray-400 hidden sm:table-cell">—</td>
              <td className="px-4 py-2 text-right text-xs">
                {shouldShowCategoryDelta(row.total, row.delta, expenseAbs) ? (
                  <ComparisonLine delta={row.delta} previousMonth={previousMonth} />
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-semibold">
            <td className="px-4 py-2 pl-6">Income subtotal</td>
            <td className="px-4 py-2 text-right text-emerald-700 tabular-nums">
              {formatSignedAmount(partitioned.incomeSubtotal)}
            </td>
            <td className="hidden sm:table-cell" />
            <td />
          </tr>
          <tr className="bg-gray-50">
            <td colSpan={4} className="px-4 py-2 text-sm font-semibold text-gray-700">
              Expenses
            </td>
          </tr>
          {visibleExpenses.map((row) => {
            const share =
              expenseAbs > 0 ? (Math.abs(parseAmount(row.total)) / expenseAbs) * 100 : 0;
            return (
              <tr key={row.category_id ?? "uncategorized-expense"}>
                <td className="px-4 py-2 pl-6">
                  {row.category_id != null ? (
                    <Link
                      to={`/transactions?category=${row.category_id}`}
                      className="text-blue-700 hover:underline"
                    >
                      {row.category_name}
                    </Link>
                  ) : (
                    row.category_name
                  )}
                </td>
                <td className="px-4 py-2 text-right text-red-700 tabular-nums">
                  {formatSignedAmount(row.total)}
                </td>
                <td className="px-4 py-2 text-right text-gray-500 tabular-nums hidden sm:table-cell">
                  {share >= 1 ? `${share.toFixed(0)}%` : "<1%"}
                </td>
                <td className="px-4 py-2 text-right text-xs">
                  {shouldShowCategoryDelta(row.total, row.delta, expenseAbs) ? (
                    <ComparisonLine delta={row.delta} previousMonth={previousMonth} />
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {hiddenCount > 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-2">
                <button
                  type="button"
                  onClick={onToggleShowAll}
                  className="text-sm text-blue-700 hover:underline"
                >
                  Show all {partitioned.expenses.length} expense categories
                </button>
              </td>
            </tr>
          )}
          {showAll && partitioned.expenses.length > TOP_CATEGORY_LIMIT && (
            <tr>
              <td colSpan={4} className="px-4 py-2">
                <button
                  type="button"
                  onClick={onToggleShowAll}
                  className="text-sm text-blue-700 hover:underline"
                >
                  Show top categories only
                </button>
              </td>
            </tr>
          )}
          <tr className="bg-gray-50 font-semibold">
            <td className="px-4 py-2 pl-6">Expense subtotal</td>
            <td className="px-4 py-2 text-right text-red-700 tabular-nums">
              {formatSignedAmount(partitioned.expenseSubtotal)}
            </td>
            <td className="hidden sm:table-cell" />
            <td />
          </tr>
          <tr className="border-t-2 border-gray-300 font-bold">
            <td className="px-4 py-3">Net</td>
            <td
              className={`px-4 py-3 text-right tabular-nums ${
                partitioned.net >= 0 ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {formatSignedAmount(partitioned.net)}
            </td>
            <td className="hidden sm:table-cell" />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SpendingLimitCards({ targets }: { targets: SpendingTargetMetrics[] }) {
  if (targets.length === 0) {
    return <p className="px-4 py-3 text-sm text-gray-500">No category budgets for this month.</p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
      {targets.map((metrics) => {
        const pct = spendingTargetProgressPercent(metrics);
        const remaining = parseAmount(metrics.remaining_to_target);
        const scheduled = parseAmount(metrics.scheduled_in_period);
        return (
          <article
            key={metrics.target_id}
            className="rounded-lg border border-gray-200 p-3 flex flex-col gap-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-gray-900">{metrics.name || metrics.category_name}</h3>
                <p className="text-xs text-gray-500">{metrics.category_name}</p>
              </div>
              <span
                className={`shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border ${spendingTargetStatusClass(metrics.status)}`}
              >
                {SPENDING_TARGET_STATUS_LABELS[metrics.status]}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden" aria-hidden>
              <div
                className={`h-full rounded-full ${
                  metrics.status === "above_target" || metrics.status === "risky"
                    ? "bg-orange-500"
                    : metrics.status === "approaching_target"
                      ? "bg-amber-400"
                      : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-600">{pct.toFixed(0)}% of limit used</p>
            <dl className="text-sm space-y-0.5">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-600">Limit</dt>
                <dd className="tabular-nums">{formatCurrency(metrics.target_amount)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-600">Spent</dt>
                <dd className="tabular-nums">{formatCurrency(metrics.spent_so_far)}</dd>
              </div>
              {scheduled > 0.005 && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-600">Scheduled</dt>
                  <dd className="tabular-nums">{formatCurrency(metrics.scheduled_in_period)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-gray-600">Remaining</dt>
                <dd className={`tabular-nums ${remaining < 0 ? "text-red-700 font-medium" : ""}`}>
                  {formatCurrency(metrics.remaining_to_target)}
                </dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function GoalProgressList({ goals }: { goals: FinancialGoal[] }) {
  const active = goals.filter((b) => b.status === "active" || b.status === "paused");
  if (active.length === 0) {
    return <p className="px-4 py-3 text-sm text-gray-500">No active goals.</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {active.map((goal) => {
        const pct = Math.min(100, Math.max(0, parseAmount(goal.progress_percent)));
        return (
          <li key={goal.id} className="px-4 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <p className="font-medium text-gray-900">{goal.name}</p>
              <p className="text-sm tabular-nums text-gray-700">
                {formatCurrency(goal.current_amount)} / {formatCurrency(goal.target_amount)}
                <span className="ml-2 text-gray-500">{pct.toFixed(0)}%</span>
              </p>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-gray-100 overflow-hidden" aria-hidden>
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Monthly needed:{" "}
              {goal.monthly_required ? `${formatCurrency(goal.monthly_required)}/mo` : "—"}
              {" · "}
              Projected: {formatProjectedCompletion(goal.projected_completion_date) ?? "—"}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

function FundingTables({ report }: { report: GoalsReport }) {
  const actual = report.monthly_funding ?? [];
  const projected = report.projected_monthly_funding ?? [];
  if (actual.length === 0 && projected.length === 0) {
    return <p className="px-4 py-3 text-sm text-gray-500">No funding activity in this window.</p>;
  }
  const renderRows = (rows: typeof actual, empty: string) =>
    rows.length === 0 ? (
      <p className="px-4 py-2 text-sm text-gray-500">{empty}</p>
    ) : (
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-gray-700">Month</th>
            <th className="px-4 py-2 text-right font-medium text-gray-700">Contributed</th>
            <th className="px-4 py-2 text-right font-medium text-gray-700">Released</th>
            <th className="px-4 py-2 text-right font-medium text-gray-700">Net funding</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((row) => (
            <tr key={`${row.kind}-${row.month}`}>
              <td className="px-4 py-2">{formatMonthLabel(row.month)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-emerald-700">
                {formatCurrency(row.contributed ?? "0")}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-amber-800">
                {parseAmount(row.released) > 0 ? formatCurrency(row.released ?? "0") : "—"}
              </td>
              <td className={`px-4 py-2 text-right tabular-nums ${deltaClassName(row.total)}`}>
                {formatSignedAmount(row.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border-t">
          Actual funding
        </h3>
        {renderRows(actual, "No actual contributions in this report window.")}
      </div>
      {projected.length > 0 && (
        <div>
          <h3 className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border-t">
            Projected funding
          </h3>
          <p className="px-4 pt-2 text-xs text-gray-500">
            Future contributions after the selected report month. These are not actual deposits.
          </p>
          {renderRows(projected, "")}
        </div>
      )}
    </div>
  );
}

function DebtSection({ debt }: { debt: CreditCardInterestReport }) {
  if (debt.by_card.length === 0 && parseAmount(debt.total_interest_paid) === 0) {
    return <p className="px-4 py-3 text-sm text-gray-500">No credit-card interest in this month.</p>;
  }
  return (
    <>
      <div className="px-4 py-3 border-b border-gray-100">
        <div className={METRIC_TILE_GRID_2}>
          <DashboardMetricTile
            label="Interest paid this month"
            value={formatCurrency(debt.total_interest_paid)}
            valueClassName="text-red-600"
          />
          <DashboardMetricTile
            label="Projected interest remaining"
            value={formatCurrency(debt.total_projected_interest_remaining)}
            valueClassName="text-amber-700"
            help="Remaining interest if each card is paid at the minimum."
          />
        </div>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {debt.highest_apr_card && (
            <div className="rounded-lg border border-gray-200 px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">Highest APR</dt>
              <dd className="font-medium text-gray-900">
                {debt.highest_apr_card.account_name} · {debt.highest_apr_card.apr}%
              </dd>
            </div>
          )}
          {debt.highest_utilization_card && (
            <div className="rounded-lg border border-gray-200 px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-gray-500">Highest utilization</dt>
              <dd className="font-medium text-gray-900">
                {debt.highest_utilization_card.account_name} ·{" "}
                {debt.highest_utilization_card.utilization_percent}%
              </dd>
            </div>
          )}
        </dl>
      </div>
      {debt.interest_trend && debt.interest_trend.length > 1 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Interest paid over time</h3>
          <InterestTrendChart trend={debt.interest_trend} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-700">Card</th>
              <th className="px-4 py-2 text-right font-medium text-gray-700">Paid</th>
              <th className="px-4 py-2 text-right font-medium text-gray-700">Projected</th>
              <th className="px-4 py-2 text-right font-medium text-gray-700 hidden sm:table-cell">
                APR
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700 hidden sm:table-cell">
                Util.
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {debt.by_card.map((row) => (
              <tr key={row.account_id}>
                <td className="px-4 py-2">{row.account_name}</td>
                <td className="px-4 py-2 text-right text-red-600 tabular-nums">
                  {formatCurrency(row.interest_paid)}
                </td>
                <td className="px-4 py-2 text-right text-amber-700 tabular-nums">
                  {formatCurrency(row.projected_interest_remaining)}
                </td>
                <td className="px-4 py-2 text-right text-gray-600 hidden sm:table-cell">
                  {row.apr ? `${row.apr}%` : "—"}
                </td>
                <td className="px-4 py-2 text-right text-gray-600 hidden sm:table-cell">
                  {row.utilization_percent ? `${row.utilization_percent}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OverviewSection({
  data,
  onOpenTab,
}: {
  data: MonthlyReports;
  onOpenTab: (tab: ReportTab) => void;
}) {
  const overview = data.overview;
  const previousMonth = overview.previous_month;
  const topCats = overview.top_expense_categories ?? [];
  const goals = overview.goals_snapshot;
  const debt = overview.debt_snapshot;

  return (
    <div className="space-y-6">
      <div className={METRIC_TILE_GRID_3}>
        <DashboardMetricTile
          label="Income"
          value={formatSignedAmount(overview.total_income)}
          valueClassName="text-emerald-700"
          subtitle={comparisonSubtitle(overview.comparison?.total_income, previousMonth)}
        />
        <DashboardMetricTile
          label="Expenses"
          value={formatSignedAmount(overview.total_expenses)}
          valueClassName="text-red-700"
          subtitle={comparisonSubtitle(overview.comparison?.total_expenses, previousMonth)}
        />
        <DashboardMetricTile
          label="Net"
          value={formatSignedAmount(overview.net)}
          valueClassName={parseAmount(overview.net) >= 0 ? "text-emerald-700" : "text-red-700"}
          subtitle={comparisonSubtitle(overview.comparison?.net, previousMonth)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-800">Top spending</h2>
            <button
              type="button"
              className="text-xs text-blue-700 hover:underline"
              onClick={() => onOpenTab("spending")}
            >
              View spending
            </button>
          </div>
          <CategorySpendBarChart rows={topCats} />
        </div>
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-800">Goals</h2>
              <button
                type="button"
                className="text-xs text-blue-700 hover:underline"
                onClick={() => onOpenTab("goals")}
              >
                View goals
              </button>
            </div>
            <p className="text-sm text-gray-700">
              {goals.total_saved ? formatCurrency(goals.total_saved) : "—"} saved of{" "}
              {goals.total_target ? formatCurrency(goals.total_target) : "—"}
            </p>
            <p className="text-xs text-gray-500">
              {goals.goals_on_track ?? 0}/{goals.goals_active_count ?? 0} on track ·{" "}
              {goals.monthly_needed_total
                ? `${formatCurrency(goals.monthly_needed_total)}/mo needed`
                : "No monthly target"}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-800">Debt</h2>
              <button
                type="button"
                className="text-xs text-blue-700 hover:underline"
                onClick={() => onOpenTab("debt")}
              >
                View debt
              </button>
            </div>
            <p className="text-sm text-gray-700">
              Interest paid {debt.total_interest_paid ? formatCurrency(debt.total_interest_paid) : "—"}
            </p>
            <p className="text-xs text-gray-500">
              {debt.highest_apr_card
                ? `Highest APR: ${debt.highest_apr_card.account_name} ${debt.highest_apr_card.apr}%`
                : "No credit cards"}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-gray-800">Budget</h2>
              <button
                type="button"
                className="text-xs text-blue-700 hover:underline"
                onClick={() => onOpenTab("spending")}
              >
                View budget
              </button>
            </div>
            <p className="text-sm text-gray-700">
              {data.spending_limits.above_target_count} above limit ·{" "}
              {data.spending_limits.approaching_target_count} approaching
            </p>
            <p className="text-xs text-gray-500">
              Category budget {formatCurrency(data.spending_limits.total_monthly_targets)}
            </p>
          </div>
          <div>
            <button
              type="button"
              className="text-xs text-blue-700 hover:underline"
              onClick={() => onOpenTab("cash-flow")}
            >
              View cash flow
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CashFlowSection({ data }: { data: MonthlyReports }) {
  const overview = data.overview;
  const previousMonth = overview.previous_month;
  return (
    <div className="space-y-6">
      <div className={METRIC_TILE_GRID_3}>
        <DashboardMetricTile
          label="Income"
          value={formatSignedAmount(overview.total_income)}
          valueClassName="text-emerald-700"
          subtitle={comparisonSubtitle(overview.comparison?.total_income, previousMonth)}
        />
        <DashboardMetricTile
          label="Expenses"
          value={formatSignedAmount(overview.total_expenses)}
          valueClassName="text-red-700"
          subtitle={comparisonSubtitle(overview.comparison?.total_expenses, previousMonth)}
        />
        <DashboardMetricTile
          label="Net cash flow"
          value={formatSignedAmount(overview.net)}
          valueClassName={parseAmount(overview.net) >= 0 ? "text-emerald-700" : "text-red-700"}
          subtitle={comparisonSubtitle(overview.comparison?.net, previousMonth)}
        />
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="text-sm font-semibold text-gray-800 mb-2">Income vs expenses</h2>
        <IncomeExpenseTrendChart trend={overview.trend} />
      </div>
    </div>
  );
}

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = useState(currentMonthStr());
  const urlTab = parseReportViewParam(searchParams.get("view"));
  const tab: ReportTab = urlTab ?? "overview";
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [fundingOpen, setFundingOpen] = useState(false);

  const { data, isPending, isError } = useQuery({
    queryKey: ["monthly-reports", month],
    queryFn: () => getMonthlyReports(month, { months: 12 }),
  });

  const previousMonth = data?.overview.previous_month;

  function setTab(next: ReportTab) {
    const params = new URLSearchParams(searchParams);
    if (next === "overview") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const idx = REPORT_TABS.findIndex((t) => t.id === tab);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setTab(REPORT_TABS[(idx + 1) % REPORT_TABS.length].id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setTab(REPORT_TABS[(idx - 1 + REPORT_TABS.length) % REPORT_TABS.length].id);
    }
  };

  return (
    <div className={PAGE_SHELL_PY_LOOSE}>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Reports
            <span className="ml-2 font-normal text-gray-500">{formatMonthLabel(month)}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Why it happened — trends for cash flow, spending, goals, and debt.
          </p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setShowAllCategories(false);
          }}
          className="shrink-0 rounded border border-gray-300 px-3 py-2 bg-white shadow-sm"
          aria-label="Report month"
        />
      </div>

      <div
        role="tablist"
        aria-label="Report sections"
        className="mb-6 flex gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1"
        onKeyDown={onTabKeyDown}
      >
        {REPORT_TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`report-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`report-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(item.id)}
              className={`flex-1 min-w-[5.5rem] rounded-md px-3 py-2 text-sm font-medium transition ${
                selected ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {isPending && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Loading {formatMonthLabel(month)}…
        </div>
      )}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Could not load reports for {formatMonthLabel(month)}.
        </div>
      )}

      {data && tab === "overview" && (
        <div role="tabpanel" id="report-panel-overview" aria-labelledby="report-tab-overview">
          <OverviewSection data={data} onOpenTab={setTab} />
        </div>
      )}

      {data && tab === "cash-flow" && (
        <div role="tabpanel" id="report-panel-cash-flow" aria-labelledby="report-tab-cash-flow">
          <CashFlowSection data={data} />
        </div>
      )}

      {data && tab === "spending" && (
        <div
          role="tabpanel"
          id="report-panel-spending"
          aria-labelledby="report-tab-spending"
          className="space-y-6"
        >
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <h2 className="px-4 py-2 font-semibold bg-gray-50">Category breakdown</h2>
            <div className="px-4 py-3 border-b border-gray-100">
              <CategorySpendBarChart rows={data.category_breakdown.breakdown} />
            </div>
            <CategoryTable
              breakdown={data.category_breakdown.breakdown}
              previousMonth={previousMonth}
              showAll={showAllCategories}
              onToggleShowAll={() => setShowAllCategories((v) => !v)}
            />
          </div>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <h2 className="px-4 py-2 font-semibold bg-gray-50">Budget performance</h2>
            <SpendingLimitCards targets={data.spending_limits.targets} />
            <div className="px-4 py-2 border-t border-gray-100">
              <Link to={SPENDING_GOALS_PATH} className="text-sm text-blue-700 hover:underline">
                Open Budget
              </Link>
            </div>
          </div>
        </div>
      )}

      {data && tab === "goals" && (
        <div
          role="tabpanel"
          id="report-panel-goals"
          aria-labelledby="report-tab-goals"
          className="space-y-6"
        >
          <div className={METRIC_TILE_GRID_3}>
            <DashboardMetricTile
              label="Total saved"
              value={formatCurrency(data.goals.summary.total_saved)}
              valueClassName="text-emerald-700"
            />
            <DashboardMetricTile
              label="Total targets"
              value={formatCurrency(data.goals.summary.total_target)}
            />
            <DashboardMetricTile
              label="Monthly needed"
              value={`${formatCurrency(data.goals.summary.monthly_needed_total)}/mo`}
            />
          </div>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <h2 className="px-4 py-2 font-semibold bg-gray-50">Goal progress</h2>
            <GoalProgressList goals={data.goals.buckets} />
          </div>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <h2 className="px-4 py-2 font-semibold bg-gray-50">Funding</h2>
            <div className="px-4 py-3 border-b border-gray-100">
              <GoalFundingChart
                actual={data.goals.monthly_funding}
                projected={data.goals.projected_monthly_funding ?? []}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 text-sm text-blue-700 hover:underline"
              onClick={() => setFundingOpen((v) => !v)}
              aria-expanded={fundingOpen}
            >
              {fundingOpen ? "Hide funding details" : "Show funding details"}
            </button>
            {fundingOpen && <FundingTables report={data.goals} />}
          </div>
        </div>
      )}

      {data && tab === "debt" && (
        <div
          role="tabpanel"
          id="report-panel-debt"
          aria-labelledby="report-tab-debt"
          className="bg-white rounded-lg shadow overflow-hidden"
        >
          <div className="px-4 py-2 bg-gray-50 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Credit card interest</h2>
            <Link to="/credit-cards" className="text-sm text-blue-700 hover:underline">
              Open Payment Planner
            </Link>
          </div>
          <DebtSection debt={data.debt} />
        </div>
      )}
    </div>
  );
}
