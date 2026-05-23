import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, currentMonthStr } from "@budget-app/shared";
import {
  getAccountBalances,
  getMonthlySummary,
  getCategoryBreakdown,
  getSafeToSpendDashboard,
  listAccountRelationships,
  listBudgets,
} from "@budget-app/api-client";
import AccountHealthBadge from "../components/AccountHealthBadge";
import { FORECAST_DAY_OPTIONS, type ForecastDays, riskStatusLabel } from "../lib/safeToSpendLabels";

export default function Dashboard() {
  const month = currentMonthStr();
  const [forecastDays, setForecastDays] = useState<ForecastDays>(30);

  const { data: balances } = useQuery({
    queryKey: ["account-balances"],
    queryFn: () => getAccountBalances(),
  });
  const { data: safeToSpend } = useQuery({
    queryKey: ["safe-to-spend-dashboard", forecastDays],
    queryFn: () => getSafeToSpendDashboard({ days: forecastDays }),
  });
  const { data: summary } = useQuery({
    queryKey: ["monthly-summary", month],
    queryFn: () => getMonthlySummary(month),
  });
  const { data: breakdown } = useQuery({
    queryKey: ["category-breakdown", month],
    queryFn: () => getCategoryBreakdown(month),
  });
  const { data: linkedRelationships } = useQuery({
    queryKey: ["account-relationships", "active"],
    queryFn: () => listAccountRelationships({ is_active: true }),
  });
  const { data: budgets } = useQuery({
    queryKey: ["budgets", month],
    queryFn: () => {
      const [y, m] = month.split("-").map(Number);
      return listBudgets({ year: y, month: m });
    },
  });

  const netWorth = balances?.balances?.reduce((s, b) => s + parseFloat(b.balance), 0) ?? 0;
  const income = summary ? parseFloat(summary.total_income) : 0;
  const expenses = summary ? Math.abs(parseFloat(summary.total_expenses)) : 0;
  const net = summary ? parseFloat(summary.net) : 0;

  const budgetMap = new Map(
    budgets?.results?.map((b) => [b.category.id, parseFloat(b.planned_amount)]) ?? []
  );
  const spentByCategory = new Map(
    breakdown?.breakdown?.filter((c) => c.category_id != null).map((c) => [c.category_id!, parseFloat(c.total)]) ?? []
  );
  const overspent = Array.from(budgetMap.entries())
    .map(([catId, planned]) => ({
      catId,
      planned,
      spent: Math.abs(spentByCategory.get(catId) ?? 0),
    }))
    .filter((x) => x.spent > x.planned)
    .slice(0, 5);

  const worst = safeToSpend?.worst_projected_account;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600 flex items-center gap-2">
          Safe-to-spend window
          <select
            value={forecastDays}
            onChange={(e) => setForecastDays(Number(e.target.value) as ForecastDays)}
            className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
          >
            {FORECAST_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4 md:col-span-2">
          <p className="text-sm text-gray-500">Safe to spend (spending & bills)</p>
          <p className="text-xl font-semibold text-emerald-800">
            {safeToSpend ? formatCurrency(safeToSpend.total_safe_to_spend) : "—"}
          </p>
          {safeToSpend &&
          (safeToSpend.accounts_needing_attention_count ?? safeToSpend.accounts_at_risk_count) > 0 ? (
            <p className="text-sm text-amber-800 mt-1">
              {safeToSpend.accounts_needing_attention_count ?? safeToSpend.accounts_at_risk_count}{" "}
              account
              {(safeToSpend.accounts_needing_attention_count ?? safeToSpend.accounts_at_risk_count) === 1
                ? ""
                : "s"}{" "}
              need attention
              {(safeToSpend.critical_accounts_count ?? 0) > 0
                ? ` (${safeToSpend.critical_accounts_count} critical)`
                : ""}
            </p>
          ) : (
            <p className="text-sm text-gray-500 mt-1">All accounts look healthy</p>
          )}
          {safeToSpend?.next_health_issue_text ? (
            <p className="text-xs text-gray-600 mt-2">{safeToSpend.next_health_issue_text}</p>
          ) : safeToSpend?.next_risk_date && worst ? (
            <p className="text-xs text-gray-600 mt-2">
              Next risk: <strong>{worst.account_name}</strong> may drop below buffer on{" "}
              {safeToSpend.next_risk_date}
            </p>
          ) : null}
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Net worth</p>
          <p className="text-xl font-semibold">{formatCurrency(netWorth)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Net (MTD)</p>
          <p className={`text-xl font-semibold ${net >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatCurrency(net)}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Income (MTD)</p>
          <p className="text-xl font-semibold text-green-600">{formatCurrency(income)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Expenses (MTD)</p>
          <p className="text-xl font-semibold text-red-600">{formatCurrency(expenses)}</p>
        </div>
      </div>
      {safeToSpend &&
        (safeToSpend.accounts_needing_attention?.length ?? safeToSpend.accounts_at_risk.length) > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold mb-2">Accounts needing attention</h2>
          <ul className="space-y-3 text-sm">
            {(safeToSpend.accounts_needing_attention?.length
              ? safeToSpend.accounts_needing_attention
              : safeToSpend.accounts_at_risk.map((a) => ({
                  account_id: a.account_id,
                  account_name: a.account_name,
                  health_status: a.risk_status,
                  health_reason: a.risk_reason,
                  health_risk_date: a.risk_date,
                }))
            ).map((a) => (
              <li key={a.account_id} className="flex flex-wrap justify-between gap-2 border-b border-gray-100 pb-2">
                <span className="font-medium">{a.account_name}</span>
                <AccountHealthBadge
                  status={a.health_status}
                  reason={a.health_reason}
                  compact
                  className="text-right"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {linkedRelationships && linkedRelationships.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold mb-2">Linked money movement</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            {linkedRelationships.slice(0, 8).map((rel) => (
              <li key={rel.id}>
                <span className="font-medium">{rel.source_account_name}</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className="font-medium">{rel.destination_account_name}</span>
                <span className="ml-2 text-xs text-gray-500">
                  {rel.relationship_type_display}
                  {rel.default_amount ? ` · $${rel.default_amount}` : ""}
                  {rel.frequency && rel.frequency !== "one_time" ? ` · ${rel.frequency}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {overspent.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold mb-2">Overspent categories</h2>
          <ul className="space-y-1">
            {overspent.map(({ catId, planned, spent }) => (
              <li key={catId} className="text-red-600 text-sm">
                Category #{catId}: spent {formatCurrency(spent)} vs planned {formatCurrency(planned)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
