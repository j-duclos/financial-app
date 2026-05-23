import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatAccountOptionLabel } from "@budget-app/shared";
import type { RecurringRule, Account, Category, RecurringRuleFrequency } from "@budget-app/shared";
import {
  listRules,
  listAccounts,
  listCategories,
  listHouseholds,
  getProfile,
  createRule,
  updateRule,
  deleteRule,
} from "@budget-app/api-client";

const FREQUENCY_LABELS: Record<RecurringRuleFrequency, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY_DAY: "Monthly (day)",
  MONTHLY_NTH_WEEKDAY: "Monthly (nth weekday)",
  YEARLY: "Yearly",
};

const WEEKDAYS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

const NTH = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
];

function cadenceSummary(rule: RecurringRule): string {
  const f = rule.frequency;
  if (f === "WEEKLY") {
    const weeks = Math.max(1, Number(rule.interval) || 1);
    return `Every ${weeks} ${weeks === 1 ? "week" : "weeks"} on ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  }
  if (f === "BIWEEKLY") {
    const weeks = Math.max(1, Number(rule.interval) || 1) * 2;
    return `Every ${weeks} ${weeks === 1 ? "week" : "weeks"} on ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  }
  if (f === "MONTHLY_DAY") return `Monthly on day ${rule.day_of_month ?? "?"}`;
  if (f === "MONTHLY_NTH_WEEKDAY") return `Monthly on ${NTH.find((n) => n.value === rule.nth_week)?.label ?? "?"} ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  if (f === "YEARLY") return `Yearly on ${rule.start_date ? new Date(rule.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "?"}`;
  return rule.frequency;
}

export default function Rules() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ruleSearch, setRuleSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    household: 0 as number,
    account_id: 0 as number,
    transfer_to_account_id: null as number | null,
    category_id: null as number | null,
    direction: "EXPENSE" as "INCOME" | "EXPENSE" | "TRANSFER",
    amount: "",
    currency: "USD",
    frequency: "MONTHLY_DAY" as RecurringRuleFrequency,
    interval: 1,
    day_of_week: null as number | null,
    day_of_month: 15,
    nth_week: null as number | null,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "" as string,
    active: true,
    notes: "",
  });
  const queryClient = useQueryClient();

  const { data: rulesData } = useQuery({
    queryKey: ["rules"],
    queryFn: () => listRules(),
    refetchOnMount: "always",
  });
  const { data: accountsData } = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });
  const { data: categoriesData } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });

  const rules = rulesData?.results ?? [];
  const filteredRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r: RecurringRule) => (r.name ?? "").toLowerCase().includes(q));
  }, [rules, ruleSearch]);
  const accounts = accountsData?.results ?? [];
  const categories = categoriesData?.results ?? [];
  const householdId = form.household || (profile?.default_household ?? households?.[0]?.id ?? 0);
  const accountsForHousehold = householdId ? accounts.filter((a: Account) => (a.household as { id?: number })?.id === householdId || a.household === householdId) : accounts;

  const createMu = useMutation({
    mutationFn: createRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      setModalOpen(false);
      setEditing(null);
      resetForm();
      setSubmitError(null);
    },
    onError: (err: Error) => setSubmitError(err.message || "Failed to create rule"),
  });
  const updateMu = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<RecurringRule> }) => updateRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rules"] });
      setModalOpen(false);
      setEditing(null);
      setSubmitError(null);
    },
    onError: (err: Error) => setSubmitError(err.message || "Failed to update rule"),
  });
  const deleteMu = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rules"] }),
  });

  function resetForm() {
    setForm({
      name: "",
      household: householdId || 0,
      account_id: 0,
      transfer_to_account_id: null,
      category_id: null,
      direction: "EXPENSE",
      amount: "",
      currency: "USD",
      frequency: "MONTHLY_DAY",
      interval: 1,
      day_of_week: null,
      day_of_month: 15,
      nth_week: null,
      start_date: new Date().toISOString().slice(0, 10),
      end_date: "",
      active: true,
      notes: "",
    });
  }

  function openCreate() {
    resetForm();
    setForm((f) => ({ ...f, household: householdId || 0 }));
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(rule: RecurringRule) {
    const rawInterval = Math.max(1, Number(rule.interval) || 1);
    const normalizedFrequency: RecurringRuleFrequency =
      rule.frequency === "BIWEEKLY" ? "WEEKLY" : rule.frequency;
    const normalizedInterval =
      rule.frequency === "BIWEEKLY" ? rawInterval * 2 : rawInterval;
    setEditing(rule);
    setForm({
      name: rule.name,
      household: typeof rule.household === "object" ? (rule.household as { id: number }).id : rule.household,
      account_id: rule.account?.id ?? (rule as { account_id?: number }).account_id ?? 0,
      transfer_to_account_id: rule.transfer_to_account?.id ?? (rule as { transfer_to_account_id?: number }).transfer_to_account_id ?? null,
      category_id: rule.category?.id ?? (rule as { category_id?: number }).category_id ?? null,
      direction: rule.direction as "INCOME" | "EXPENSE" | "TRANSFER",
      amount: rule.amount,
      currency: rule.currency || "USD",
      frequency: normalizedFrequency,
      interval: normalizedInterval,
      day_of_week: rule.day_of_week ?? null,
      day_of_month: rule.day_of_month ?? 15,
      nth_week: rule.nth_week ?? null,
      start_date: rule.start_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      end_date: rule.end_date?.slice(0, 10) ?? "",
      active: rule.active,
      notes: rule.notes ?? "",
    });
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const selectedCat = categories.find((c: Category) => c.id === form.category_id);
    const catName = selectedCat?.name ?? "";
    const transferAllowed =
      catName === "Credit Card Payment" || catName === "Bank Transfer";
    const payload = {
      household: form.household || householdId,
      name: form.name,
      account_id: form.account_id,
      transfer_to_account_id: transferAllowed ? (form.transfer_to_account_id ?? null) : null,
      category_id: form.category_id,
      direction: form.direction,
      amount: form.amount,
      currency: form.currency,
      frequency: form.frequency,
      interval: form.interval,
      day_of_week: form.day_of_week,
      day_of_month: form.frequency === "MONTHLY_DAY" || form.frequency === "MONTHLY_NTH_WEEKDAY" ? form.day_of_month : undefined,
      nth_week: form.frequency === "MONTHLY_NTH_WEEKDAY" ? form.nth_week : undefined,
      start_date: form.start_date,
      end_date: form.end_date || null,
      active: form.active,
      notes: form.notes || null,
    };
    if (editing) {
      updateMu.mutate({ id: editing.id, data: payload as Partial<RecurringRule> });
    } else {
      createMu.mutate(payload as Parameters<typeof createRule>[0]);
    }
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
        <h1 className="text-xl font-semibold">Recurring Rules</h1>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search rules by name..."
            value={ruleSearch}
            onChange={(e) => setRuleSearch(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm w-48"
          />
          <button
            type="button"
            onClick={openCreate}
            className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
          >
            Add rule
          </button>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Cadence</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredRules.map((rule: RecurringRule) => (
              <tr key={rule.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm">{rule.name}</td>
                <td className="px-4 py-2 text-sm">{rule.account?.name ?? "-"}</td>
                <td className="px-4 py-2 text-sm">
                  <span className={rule.direction === "EXPENSE" ? "text-red-600" : "text-green-600"}>
                    {rule.direction === "EXPENSE" ? "-" : "+"}
                    {formatCurrency(rule.amount, rule.currency)}
                  </span>
                </td>
                <td className="px-4 py-2 text-sm text-gray-600">{cadenceSummary(rule)}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${rule.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"}`}>
                    {rule.active ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <button type="button" onClick={() => openEdit(rule)} className="text-blue-600 text-sm mr-2 hover:underline">
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => window.confirm("Delete this rule?") && deleteMu.mutate(rule.id)}
                    className="text-red-600 text-sm hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && (
          <p className="px-4 py-8 text-center text-gray-500">No rules yet. Add a rule to project recurring income or expenses.</p>
        )}
        {rules.length > 0 && filteredRules.length === 0 && (
          <p className="px-4 py-8 text-center text-gray-500">No rules match &quot;{ruleSearch}&quot;.</p>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b font-medium">{editing ? "Edit rule" : "New rule"}</div>
            {editing && (
              <p className="px-4 pt-2 text-xs text-gray-500 bg-amber-50 border-b border-amber-100">
                Saving this rule moves any existing transactions created from it to the rule&apos;s current account, so they appear on one ledger only. Future projected amounts use the rule&apos;s account.
              </p>
            )}
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              {submitError && <p className="text-red-600 text-sm">{submitError}</p>}
              <div>
                <label className="block text-sm font-medium text-gray-700">Household</label>
                <select
                  value={form.household || ""}
                  onChange={(e) => setForm((f) => ({ ...f, household: Number(e.target.value) }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  required
                >
                  <option value="">Select</option>
                  {(households ?? []).map((h: { id: number; name: string }) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Account</label>
                <select
                  value={form.account_id || ""}
                  onChange={(e) => setForm((f) => ({ ...f, account_id: Number(e.target.value) }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  required
                >
                  <option value="">Select</option>
                  {accountsForHousehold.map((a: Account) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Category</label>
                <select
                  value={form.category_id ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      category_id: e.target.value ? Number(e.target.value) : null,
                      transfer_to_account_id: null,
                    }))
                  }
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {categories
                    .filter((c: Category) => (c.household as number) === (form.household || householdId))
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))
                    .map((c: Category) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
              </div>
              {(() => {
                const selectedCategory = categories.find((c: Category) => c.id === form.category_id);
                const isCreditCardPayment = selectedCategory?.name === "Credit Card Payment";
                const isBankTransfer = selectedCategory?.name === "Bank Transfer";
                const creditCardAccounts = accountsForHousehold.filter(
                  (a: Account) => a.account_type === "CREDIT" && a.id !== form.account_id
                );
                const otherAccountsForTransfer = accountsForHousehold.filter(
                  (a: Account) => a.id !== form.account_id
                );
                if (isCreditCardPayment && creditCardAccounts.length > 0) {
                  return (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Pay to account (credit card)</label>
                      <select
                        value={form.transfer_to_account_id ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            transfer_to_account_id: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Select credit card</option>
                        {creditCardAccounts.map((a: Account) => (
                          <option key={a.id} value={a.id}>
                            {formatAccountOptionLabel(a)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-0.5 text-xs text-gray-500">
                        This will create a transfer: expense from the account above, payment into the selected card.
                      </p>
                    </div>
                  );
                }
                if (isBankTransfer && otherAccountsForTransfer.length > 0) {
                  return (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Transfer to account</label>
                      <select
                        value={form.transfer_to_account_id ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            transfer_to_account_id: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        required
                      >
                        <option value="">Select destination account</option>
                        {otherAccountsForTransfer.map((a: Account) => (
                          <option key={a.id} value={a.id}>
                            {formatAccountOptionLabel(a)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Money moves from the account above to this account.
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700">Direction</label>
                  <select
                    value={form.direction}
                    onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as "INCOME" | "EXPENSE" | "TRANSFER" }))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="INCOME">Income</option>
                    <option value="EXPENSE">Expense</option>
                    <option value="TRANSFER">Transfer</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Frequency</label>
                <select
                  value={form.frequency}
                  onChange={(e) => {
                    const freq = e.target.value as RecurringRuleFrequency;
                    setForm((f) => {
                      const next = { ...f, frequency: freq };
                      if (freq === "WEEKLY" && f.start_date) {
                        const d = new Date(f.start_date + "T12:00:00");
                        next.day_of_week = (d.getDay() + 6) % 7;
                      }
                      return next;
                    });
                  }}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {Object.entries(FREQUENCY_LABELS)
                    .filter(([k]) => k !== "BIWEEKLY")
                    .map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              {form.frequency === "WEEKLY" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Every how many weeks?</label>
                    <input
                      type="number"
                      min={1}
                      max={52}
                      value={form.interval}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          interval: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <p className="mt-0.5 text-xs text-gray-500">
                      Example: 2 = every other week, 3 = every 3 weeks.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Day of week</label>
                    <select
                      value={form.day_of_week ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, day_of_week: e.target.value ? Number(e.target.value) : null }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {WEEKDAYS.map((w) => (
                        <option key={w.value} value={w.value}>{w.label}</option>
                      ))}
                    </select>
                    <p className="mt-0.5 text-xs text-gray-500">First occurrence is this weekday on or after the start date.</p>
                  </div>
                </>
              )}
              {form.frequency === "MONTHLY_DAY" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Day of month (1–31)</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.day_of_month ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, day_of_month: e.target.value ? Number(e.target.value) : 15 }))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              )}
              {form.frequency === "MONTHLY_NTH_WEEKDAY" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Nth weekday (e.g. 2nd)</label>
                    <select
                      value={form.nth_week ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, nth_week: e.target.value ? Number(e.target.value) : null }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {NTH.map((n) => (
                        <option key={n.value} value={n.value}>{n.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Weekday</label>
                    <select
                      value={form.day_of_week ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, day_of_week: e.target.value ? Number(e.target.value) : null }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {WEEKDAYS.map((w) => (
                        <option key={w.value} value={w.value}>{w.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Start date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => {
                        const next = { ...f, start_date: v };
                        if (f.frequency === "WEEKLY" && v) {
                          const d = new Date(v + "T12:00:00");
                          next.day_of_week = (d.getDay() + 6) % 7;
                        }
                        return next;
                      });
                    }}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">End date (optional)</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                  className="rounded border-gray-300"
                />
                <label htmlFor="active" className="text-sm text-gray-700">Active</label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                  {editing ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
