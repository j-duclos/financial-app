import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, currentMonthStr } from "@budget-app/shared";
import {
  getMonthlySummary,
  getCategoryBreakdown,
  getCreditCardInterestReport,
  getGoalsReport,
  getSpendingTargetsSummary,
} from "@budget-app/api-client";
import { SPENDING_TARGET_STATUS_LABELS } from "../lib/spendingTargetDisplay";
import { formatProjectedCompletion } from "../lib/goalDisplay";
import { partitionCategoryBreakdown } from "../lib/categoryBreakdownDisplay";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import { METRIC_TILE_GRID_2, METRIC_TILE_GRID_3 } from "../components/dashboard/metricTileLayout";
import { PAGE_SHELL_PY_LOOSE } from "../lib/pageLayout";

export default function Reports() {
  const [month, setMonth] = useState(currentMonthStr());
  const { data: summary } = useQuery({
    queryKey: ["monthly-summary", month],
    queryFn: () => getMonthlySummary(month),
  });
  const { data: breakdownData } = useQuery({
    queryKey: ["category-breakdown", month],
    queryFn: () => getCategoryBreakdown(month),
  });
  const { data: ccInterest } = useQuery({
    queryKey: ["credit-card-interest", month],
    queryFn: () => getCreditCardInterestReport(month),
  });
  const { data: goalsReport } = useQuery({
    queryKey: ["goals-report", month],
    queryFn: () => getGoalsReport({ months: 12, month }),
  });
  const anchor = `${month}-15`;
  const { data: targetsReport } = useQuery({
    queryKey: ["spending-targets-report", month],
    queryFn: () => getSpendingTargetsSummary({ anchor }),
  });
  const breakdown = breakdownData?.breakdown ?? [];
  const partitionedBreakdown = partitionCategoryBreakdown(breakdown);

  return (
    <div className={PAGE_SHELL_PY_LOOSE}>
      <div className="mb-8 flex flex-col md:flex-row md:items-end gap-4">
        {summary && (
          <div className={`${METRIC_TILE_GRID_3} flex-1 min-w-0`}>
            <DashboardMetricTile
              label="Total income"
              value={formatCurrency(summary.total_income)}
              valueClassName="text-green-600"
            />
            <DashboardMetricTile
              label="Total expenses"
              value={formatCurrency(summary.total_expenses)}
              valueClassName="text-red-600"
            />
            <DashboardMetricTile
              label="Net"
              value={formatCurrency(summary.net)}
              valueClassName={
                parseFloat(summary.net) >= 0 ? "text-green-600" : "text-red-600"
              }
            />
          </div>
        )}
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="shrink-0 self-end rounded border border-gray-300 px-3 py-2 bg-white shadow-sm"
          aria-label="Report month"
        />
      </div>
      {ccInterest && (ccInterest.by_card.length > 0 || parseFloat(ccInterest.total_interest_paid) > 0) && (
        <div className="bg-white rounded-lg shadow overflow-hidden mb-8">
          <h2 className="px-4 py-2 font-semibold bg-gray-50">Credit card interest</h2>
          <div className="px-4 py-3 border-b border-gray-100">
            <div className={METRIC_TILE_GRID_2}>
              <DashboardMetricTile
                label="Interest paid this month"
                value={formatCurrency(ccInterest.total_interest_paid)}
                valueClassName="text-red-600"
              />
              <DashboardMetricTile
                label="Projected interest remaining (min. payment)"
                value={formatCurrency(ccInterest.total_projected_interest_remaining)}
                valueClassName="text-amber-700"
              />
            </div>
          </div>
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-700">Card</th>
                <th className="px-4 py-2 text-right font-medium text-gray-700">Paid</th>
                <th className="px-4 py-2 text-right font-medium text-gray-700">Projected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {ccInterest.by_card.map((row) => (
                <tr key={row.account_id}>
                  <td className="px-4 py-2">{row.account_name}</td>
                  <td className="px-4 py-2 text-right text-red-600">
                    {formatCurrency(row.interest_paid)}
                  </td>
                  <td className="px-4 py-2 text-right text-amber-700">
                    {formatCurrency(row.projected_interest_remaining)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {goalsReport && goalsReport.buckets.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden mb-8">
          <h2 className="px-4 py-2 font-semibold bg-gray-50">Goal growth & funding</h2>
          <div className="px-4 py-3 border-b border-gray-100">
            <div className={METRIC_TILE_GRID_3}>
              <DashboardMetricTile
                label="Total saved (buckets)"
                value={formatCurrency(goalsReport.summary.total_saved)}
                valueClassName="text-emerald-700"
              />
              <DashboardMetricTile
                label="Total targets"
                value={formatCurrency(goalsReport.summary.total_target)}
              />
              <DashboardMetricTile
                label="Monthly needed (all goals)"
                value={`${formatCurrency(goalsReport.summary.monthly_needed_total)}/mo`}
              />
            </div>
          </div>
          <table className="min-w-full divide-y divide-gray-200 text-sm mb-4">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-700">Goal</th>
                <th className="px-4 py-2 text-right font-medium text-gray-700">Progress</th>
                <th className="px-4 py-2 text-right font-medium text-gray-700">Projected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {goalsReport.buckets
                .filter((b) => b.status === "active" || b.status === "paused")
                .map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2">{b.name}</td>
                    <td className="px-4 py-2 text-right">
                      {formatCurrency(b.current_amount)} / {formatCurrency(b.target_amount)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {formatProjectedCompletion(b.projected_completion_date) ?? "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {goalsReport.monthly_funding.length > 0 && (
            <>
              <h3 className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 border-t">
                Monthly contributions
              </h3>
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-700">Month</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-700">Funded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {goalsReport.monthly_funding.map((row) => (
                    <tr key={row.month}>
                      <td className="px-4 py-2">{row.month}</td>
                      <td className="px-4 py-2 text-right text-emerald-700">
                        {formatCurrency(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {targetsReport && targetsReport.targets.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden mb-8">
          <h2 className="px-4 py-2 font-semibold bg-gray-50">Spending limit performance</h2>
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-700">Category</th>
                <th className="px-4 py-2 text-right font-medium text-gray-700">Limit</th>
                <th className="px-4 py-2 text-right font-medium text-gray-700">Spent</th>
                <th className="px-4 py-2 text-right font-medium text-gray-700">Scheduled</th>
                <th className="px-4 py-2 text-right font-medium text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {targetsReport.targets.map((row) => (
                <tr key={row.target_id}>
                  <td className="px-4 py-2">{row.category_name}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(row.target_amount)}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(row.spent_so_far)}</td>
                  <td className="px-4 py-2 text-right">
                    {formatCurrency(row.scheduled_in_period ?? "0")}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-700">
                    {SPENDING_TARGET_STATUS_LABELS[row.status]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <h2 className="px-4 py-2 font-semibold bg-gray-50">Category breakdown</h2>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Category</th>
              <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            <tr className="bg-gray-50">
              <td colSpan={2} className="px-4 py-2 text-sm font-semibold text-gray-700">
                Income
              </td>
            </tr>
            {partitionedBreakdown.income.map((row) => (
              <tr key={row.category_id ?? "uncategorized-income"}>
                <td className="px-4 py-2 pl-6">{row.category_name}</td>
                <td className="px-4 py-2 text-right text-green-600">{formatCurrency(row.total)}</td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="px-4 py-2 pl-6">Income subtotal</td>
              <td className="px-4 py-2 text-right text-green-600">
                {formatCurrency(partitionedBreakdown.incomeSubtotal)}
              </td>
            </tr>
            <tr className="bg-gray-50">
              <td colSpan={2} className="px-4 py-2 text-sm font-semibold text-gray-700">
                Expenses
              </td>
            </tr>
            {partitionedBreakdown.expenses.map((row) => (
              <tr key={row.category_id ?? "uncategorized-expense"}>
                <td className="px-4 py-2 pl-6">{row.category_name}</td>
                <td className="px-4 py-2 text-right text-red-600">{formatCurrency(row.total)}</td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="px-4 py-2 pl-6">Expense subtotal</td>
              <td className="px-4 py-2 text-right text-red-600">
                {formatCurrency(partitionedBreakdown.expenseSubtotal)}
              </td>
            </tr>
            <tr className="border-t-2 border-gray-300 font-bold">
              <td className="px-4 py-3">Net</td>
              <td
                className={`px-4 py-3 text-right ${
                  partitionedBreakdown.net >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {formatCurrency(partitionedBreakdown.net)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
