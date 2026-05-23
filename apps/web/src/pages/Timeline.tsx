import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import type { TimelineRow } from "@budget-app/shared";
import { getTimeline, listAccounts, listScenarios, getProfile, listHouseholds } from "@budget-app/api-client";

type Horizon = "3m" | "6m" | "12m" | "24m";

export default function Timeline() {
  const [horizon, setHorizon] = useState<Horizon>("6m");
  const [accountId, setAccountId] = useState<number | "">("");
  const [scenarioId, setScenarioId] = useState<number | "">("");
  const [householdId, setHouseholdId] = useState<number | "">("");

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: accountsData } = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });
  const { data: scenariosData } = useQuery({ queryKey: ["scenarios"], queryFn: () => listScenarios() });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const accounts = accountsData?.results ?? [];
  const scenarios = scenariosData?.results ?? [];
  const defaultHousehold = profile?.default_household ?? households?.[0]?.id;

  const { data: timelineData, isLoading, error } = useQuery({
    queryKey: ["timeline", horizon, accountId, scenarioId, householdId || defaultHousehold],
    queryFn: () =>
      getTimeline({
        horizon,
        account_id: accountId || undefined,
        scenario_id: scenarioId || undefined,
        household_id: householdId || defaultHousehold || undefined,
      }),
  });

  const timeline = timelineData?.timeline ?? [];
  const accountSummary = timelineData?.account_summary ?? [];

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Financial Timeline</h1>
      <div className="flex flex-wrap gap-4 mb-4 items-center">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Horizon</label>
          <select
            value={horizon}
            onChange={(e) => setHorizon(e.target.value as Horizon)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="3m">3 months</option>
            <option value="6m">6 months</option>
            <option value="12m">12 months</option>
            <option value="24m">24 months</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Account</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[160px]"
          >
            <option value="">All accounts</option>
            {accounts.map((a: { id: number; name: string }) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Scenario</label>
          <select
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value === "" ? "" : Number(e.target.value))}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm min-w-[160px]"
          >
            <option value="">Base</option>
            {scenarios.map((s: { id: number; name: string }) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {accountSummary.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {accountSummary.map((a: { account_id: number; account_name: string; ending_balance: string }) => (
            <div key={a.account_id} className="bg-white border border-gray-200 rounded-lg p-3">
              <p className="text-xs text-gray-500 truncate">{a.account_name}</p>
              <p className={`text-sm font-medium ${parseFloat(a.ending_balance) >= 0 ? "text-gray-900" : "text-red-600"}`}>
                {formatCurrency(a.ending_balance, "USD")}
              </p>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-red-600 text-sm mb-2">{(error as Error).message}</p>
      )}
      {isLoading ? (
        <p className="text-gray-500">Loading timeline…</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Running balance</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {timeline.map((row: TimelineRow, i: number) => (
                <tr key={i} className={row.source === "rule" ? "bg-amber-50/50" : ""}>
                  <td className="px-4 py-2 text-sm whitespace-nowrap">{row.date}</td>
                  <td className="px-4 py-2 text-sm">{row.description}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{row.account_name}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{row.category_name ?? "—"}</td>
                  <td className={`px-4 py-2 text-sm text-right font-medium ${parseFloat(row.amount) >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {parseFloat(row.amount) >= 0 ? "+" : ""}{formatCurrency(row.amount, "USD")}
                  </td>
                  <td className="px-4 py-2 text-sm text-right text-gray-700">{formatCurrency(row.running_balance, "USD")}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${row.source === "rule" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-700"}`}>
                      {row.source === "actual" ? "Actual" : "Planned"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {timeline.length === 0 && !isLoading && (
            <p className="px-4 py-8 text-center text-gray-500">No timeline entries in range. Add accounts and rules, or widen the horizon.</p>
          )}
        </div>
      )}
    </div>
  );
}
