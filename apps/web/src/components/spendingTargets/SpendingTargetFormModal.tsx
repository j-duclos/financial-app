import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Category, SpendingTarget, SpendingTargetPeriod, SpendingTargetType } from "@budget-app/shared";
import { suggestSpendingTargetType } from "@budget-app/api-client";

const PERIODS: SpendingTargetPeriod[] = ["weekly", "monthly", "quarterly", "yearly"];

type Props = {
  open: boolean;
  categories: Category[];
  householdId: number | null;
  initial?: SpendingTarget | null;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
};

export default function SpendingTargetFormModal({
  open,
  categories,
  householdId,
  initial,
  onClose,
  onSave,
}: Props) {
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [targetAmount, setTargetAmount] = useState("");
  const [period, setPeriod] = useState<SpendingTargetPeriod>("monthly");
  const [targetType, setTargetType] = useState<SpendingTargetType>("variable");
  const [warningThreshold, setWarningThreshold] = useState("80");
  const [notes, setNotes] = useState("");
  const [suggestReason, setSuggestReason] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setCategoryId(initial.category.id);
      setTargetAmount(initial.target_amount);
      setPeriod(initial.period);
      setTargetType(initial.target_type ?? "variable");
      setWarningThreshold(initial.warning_threshold_percent);
      setNotes(initial.notes ?? "");
      setSuggestReason(null);
    } else {
      setCategoryId("");
      setTargetAmount("");
      setPeriod("monthly");
      setTargetType("variable");
      setWarningThreshold("80");
      setNotes("");
      setSuggestReason(null);
    }
  }, [open, initial]);

  const { data: suggestion } = useQuery({
    queryKey: ["spending-target-suggest-type", categoryId],
    queryFn: () => suggestSpendingTargetType(categoryId as number),
    enabled: open && !initial && typeof categoryId === "number",
  });

  useEffect(() => {
    if (!open || initial || typeof categoryId !== "number" || !suggestion) return;
    setTargetType(suggestion.target_type);
    setSuggestReason(suggestion.reason);
  }, [open, initial, categoryId, suggestion]);

  const expenseCats = useMemo(() => {
    const seen = new Set<string>();
    return categories
      .filter((c) => c.category_type === "EXPENSE" && !c.is_archived)
      .filter((c) => {
        const key = c.name.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
      );
  }, [categories]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4 space-y-3">
        <h2 className="text-lg font-semibold">
          {initial ? "Edit spending limit" : "Add spending limit"}
        </h2>
        <label className="block text-sm">
          <span className="text-gray-600">Category</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            disabled={!!initial}
          >
            <option value="">Select category</option>
            {expenseCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">Limit amount</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">Period</span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as SpendingTargetPeriod)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm space-y-2">
          <legend className="text-gray-600">Limit behavior</legend>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="target_type"
              value="fixed"
              checked={targetType === "fixed"}
              onChange={() => setTargetType("fixed")}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-gray-900">Fixed / scheduled</span>
              <span className="block text-xs text-gray-500">
                Use known bills and scheduled payments only.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="target_type"
              value="variable"
              checked={targetType === "variable"}
              onChange={() => setTargetType("variable")}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-gray-900">Variable</span>
              <span className="block text-xs text-gray-500">
                For discretionary spending — counts posted transactions plus known future ones only.
              </span>
            </span>
          </label>
          {suggestReason && !initial && (
            <p className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1">
              Suggested: {suggestReason}
            </p>
          )}
        </fieldset>
        <label className="block text-sm">
          <span className="text-gray-600">Warning threshold (%)</span>
          <input
            type="number"
            min="0"
            max="100"
            value={warningThreshold}
            onChange={(e) => setWarningThreshold(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-600">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-gray-300"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!householdId || !categoryId || !targetAmount}
            onClick={() => {
              if (!householdId || !categoryId) return;
              onSave({
                household: householdId,
                category: categoryId,
                target_amount: targetAmount,
                period,
                target_type: targetType,
                warning_threshold_percent: warningThreshold,
                notes,
              });
            }}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
