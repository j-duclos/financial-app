import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatMonth, currentMonthStr } from "@budget-app/shared";
import {
  listBudgets,
  listHouseholds,
  listCategories,
  getCategoryBreakdown,
  createBudget,
  updateBudget,
} from "@budget-app/api-client";

export default function Budget() {
  const [month, setMonth] = useState(currentMonthStr());
  const queryClient = useQueryClient();
  const [y, m] = month.split("-").map(Number);

  const { data: budgetsData } = useQuery({
    queryKey: ["budgets", month],
    queryFn: () => listBudgets({ year: y, month: m }),
  });
  const { data: categoriesData } = useQuery({
    queryKey: ["categories"],
    queryFn: () => listCategories({ page_size: 500 }),
  });
  const { data: breakdownData } = useQuery({
    queryKey: ["category-breakdown", month],
    queryFn: () => getCategoryBreakdown(month),
  });

  const budgets = budgetsData?.results ?? [];
  const categories = categoriesData?.results ?? [];
  const breakdown = breakdownData?.breakdown ?? [];
  const breakdownByCat = new Map(breakdown.map((b) => [b.category_id, parseFloat(b.total)]));

  const expenseCategories = useMemo(() => {
    return categories
      .filter((c) => c.category_type === "EXPENSE" && !c.is_archived)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
  }, [categories]);
  const budgetByCat = new Map(budgets.map((b) => [b.category.id, b]));

  const createMu = useMutation({
    mutationFn: (body: { household: number; category: number; year: number; month: number; planned_amount: string }) =>
      createBudget(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["budgets"] }),
  });
  const updateMu = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { planned_amount: string } }) => updateBudget(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["budgets"] }),
  });

  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const householdId = (categories[0] as { household?: number } | undefined)?.household ?? households?.[0]?.id;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Budget</h1>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </div>
      <p className="text-gray-600 mb-4">{formatMonth(y, m)}</p>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Category</th>
              <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Planned</th>
              <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Spent</th>
              <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {expenseCategories.map((cat) => {
              const planned = budgetByCat.get(cat.id);
              const plannedAmt = planned ? parseFloat(planned.planned_amount) : 0;
              const spent = Math.abs(breakdownByCat.get(cat.id) ?? 0);
              const remaining = plannedAmt - spent;
              return (
                <tr key={cat.id}>
                  <td className="px-4 py-2">{cat.name}</td>
                  <td className="px-4 py-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={plannedAmt}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        if (planned) {
                          updateMu.mutate({ id: planned.id, data: { planned_amount: String(v) } });
                        } else if (householdId) {
                          createMu.mutate({
                            household: householdId,
                            category: cat.id,
                            year: y,
                            month: m,
                            planned_amount: String(v),
                          });
                        }
                      }}
                      className="w-24 text-right rounded border border-gray-300 px-2 py-1"
                    />
                  </td>
                  <td className="px-4 py-2 text-right text-red-600">{formatCurrency(spent)}</td>
                  <td className={`px-4 py-2 text-right ${remaining >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatCurrency(remaining)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
