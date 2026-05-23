import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatMonth, currentMonthStr } from "@budget-app/shared";
import { getMonthlySummary, getCategoryBreakdown } from "@budget-app/api-client";

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
  const [y, m] = month.split("-").map(Number);
  const breakdown = breakdownData?.breakdown ?? [];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Reports</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </div>
      <p className="text-gray-600 mb-6">{formatMonth(y, m)}</p>
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Total income</p>
            <p className="text-xl font-semibold text-green-600">{formatCurrency(summary.total_income)}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Total expenses</p>
            <p className="text-xl font-semibold text-red-600">{formatCurrency(summary.total_expenses)}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-sm text-gray-500">Net</p>
            <p className={`text-xl font-semibold ${parseFloat(summary.net) >= 0 ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(summary.net)}
            </p>
          </div>
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
            {breakdown.map((row) => (
              <tr key={row.category_id ?? "uncategorized"}>
                <td className="px-4 py-2">{row.category_name}</td>
                <td className={`px-4 py-2 text-right ${parseFloat(row.total) >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {formatCurrency(row.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
