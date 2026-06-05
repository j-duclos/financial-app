import { useEffect, useMemo, useState } from "react";
import type { Account, FinancialGoal, FinancialGoalStatus, FinancialGoalType } from "@budget-app/shared";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import { bucketPriorityToNumber } from "../../lib/bucketGoalTypes";
import { GOAL_TYPE_OPTIONS, isDebtGoalType } from "../../lib/goalDisplay";
import GoalFundingSection from "./GoalFundingSection";
import {
  emptyGoalFundingForm,
  type GoalFundingFormState,
  validateGoalFundingForm,
} from "../../lib/goalFundingForm";
import type { RecurringRule } from "@budget-app/shared";

export type GoalFormValues = {
  name: string;
  description: string;
  goal_type: FinancialGoalType;
  target_amount: string;
  starting_debt_amount: string;
  target_date: string;
  linked_account: number | "";
  linked_credit_account: number | "";
  monthly_contribution: string;
  priority: number;
  include_in_safe_to_spend: boolean;
  forecast_enabled: boolean;
  auto_fund_enabled: boolean;
  notes: string;
  funding: GoalFundingFormState;
};

const emptyForm: GoalFormValues = {
  name: "",
  description: "",
  goal_type: "emergency",
  target_amount: "",
  starting_debt_amount: "",
  target_date: "",
  linked_account: "",
  linked_credit_account: "",
  monthly_contribution: "0",
  priority: 3,
  include_in_safe_to_spend: true,
  forecast_enabled: true,
  auto_fund_enabled: false,
  notes: "",
  funding: emptyGoalFundingForm,
};

/** Positive amount owed on a credit card or loan (from listAccounts balance=true). */
function creditBalanceOwed(account: Account): number | null {
  if (account.balance_owed != null && account.balance_owed !== "") {
    const n = parseFloat(account.balance_owed);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (account.current_balance != null && account.current_balance !== "") {
    const n = parseFloat(account.current_balance);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function formatOwedForInput(owed: number): string {
  return owed.toFixed(2);
}

const ACTIVE_GOAL_STATUSES: FinancialGoalStatus[] = ["active", "paused"];

function accountUsedByAnotherGoal(
  accountId: number,
  goals: FinancialGoal[],
  editingGoalId?: number
): string | null {
  for (const g of goals) {
    if (editingGoalId != null && g.id === editingGoalId) continue;
    if (!g.status || !ACTIVE_GOAL_STATUSES.includes(g.status)) continue;
    const linked = g.linked_account ?? g.linked_credit_account;
    if (linked === accountId) return g.name;
  }
  return null;
}

type Props = {
  open: boolean;
  householdId: number;
  accounts: Account[];
  existingGoals?: FinancialGoal[];
  incomeRules?: RecurringRule[];
  rulesLoading?: boolean;
  initialFunding?: GoalFundingFormState;
  initial?: FinancialGoal | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (values: GoalFormValues) => void;
};

export default function GoalFormModal({
  open,
  householdId,
  accounts,
  existingGoals = [],
  incomeRules = [],
  rulesLoading,
  initialFunding,
  initial,
  saving,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<GoalFormValues>(emptyForm);
  const [fundingError, setFundingError] = useState<string | null>(null);

  const isDebt = isDebtGoalType(form.goal_type);

  const savingsAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (a.status === "active" || !a.status) &&
          !a.is_hidden &&
          (a.account_type === "CHECKING" ||
            a.account_type === "SAVINGS" ||
            a.account_type === "CASH")
      ),
    [accounts]
  );

  const debtAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (a.status === "active" || !a.status) &&
          !a.is_hidden &&
          (a.account_type === "CREDIT" || a.role === "loan")
      ),
    [accounts]
  );

  const selectedDebtAccount = useMemo(() => {
    if (!form.linked_credit_account) return undefined;
    return debtAccounts.find((a) => a.id === form.linked_credit_account);
  }, [debtAccounts, form.linked_credit_account]);

  const debtBalanceOwedToday = selectedDebtAccount
    ? creditBalanceOwed(selectedDebtAccount)
    : null;

  function applyDebtAccountSelection(accountId: number | "") {
    const account = accountId ? debtAccounts.find((a) => a.id === accountId) : undefined;
    const owed = account ? creditBalanceOwed(account) : null;
    const owedStr = owed != null ? formatOwedForInput(owed) : "";

    setForm((f) => ({
      ...f,
      linked_credit_account: accountId,
      starting_debt_amount: owedStr || f.starting_debt_amount,
      target_amount:
        owedStr && (!f.target_amount.trim() || parseFloat(f.target_amount) === 0)
          ? owedStr
          : f.target_amount,
    }));
  }

  useEffect(() => {
    if (!open) return;
    setFundingError(null);
    if (initial) {
      setForm({
        name: initial.name,
        description: initial.description ?? "",
        goal_type: initial.goal_type,
        target_amount: initial.target_amount,
        starting_debt_amount: initial.starting_debt_amount ?? "",
        target_date: initial.target_date ?? "",
        linked_account: initial.linked_account ?? "",
        linked_credit_account:
          initial.linked_credit_account ?? initial.linked_account ?? "",
        monthly_contribution: initial.monthly_contribution ?? initial.monthly_target ?? "0",
        priority:
          typeof initial.priority === "number"
            ? initial.priority
            : bucketPriorityToNumber(initial.priority),
        include_in_safe_to_spend: initial.include_in_safe_to_spend ?? true,
        forecast_enabled: initial.forecast_enabled ?? true,
        auto_fund_enabled: initial.auto_fund_enabled ?? false,
        notes: initial.notes ?? "",
        funding: initialFunding ?? {
          ...emptyGoalFundingForm,
          enabled: initial.auto_fund_enabled ?? false,
        },
      });
    } else {
      setForm({ ...emptyForm });
    }
  }, [open, initial, initialFunding]);

  useEffect(() => {
    if (!open || !isDebtGoalType(form.goal_type) || !form.linked_credit_account) return;
    const account = debtAccounts.find((a) => a.id === form.linked_credit_account);
    if (!account) return;
    const owed = creditBalanceOwed(account);
    if (owed == null) return;
    const owedStr = formatOwedForInput(owed);
    setForm((f) => {
      if (f.starting_debt_amount && parseFloat(f.starting_debt_amount) > 0) {
        return f;
      }
      return {
        ...f,
        starting_debt_amount: owedStr,
        target_amount:
          !f.target_amount.trim() || parseFloat(f.target_amount) === 0 ? owedStr : f.target_amount,
      };
    });
  }, [open, form.goal_type, form.linked_credit_account, debtAccounts]);

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isDebt) {
      const err = validateGoalFundingForm(form.funding, form.monthly_contribution);
      if (err) {
        setFundingError(err);
        return;
      }
    }
    setFundingError(null);
    onSubmit({
      ...form,
      auto_fund_enabled: form.funding.enabled,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">{initial ? "Edit goal bucket" : "Add goal bucket"}</h2>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800">
              Close
            </button>
          </div>

          <label className="block text-sm">
            <span className="text-gray-700">Goal name</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm">
            <span className="text-gray-700">Goal type</span>
            <select
              value={form.goal_type}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  goal_type: e.target.value as FinancialGoalType,
                  linked_account: "",
                  linked_credit_account: "",
                }))
              }
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {GOAL_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {!isDebt && (
            <label className="block text-sm">
              <span className="text-gray-700">Target amount</span>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.target_amount}
                onChange={(e) => setForm((f) => ({ ...f, target_amount: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="block text-sm">
            <span className="text-gray-700">Description (optional)</span>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          {isDebt && (
            <label className="block text-sm">
              <span className="text-gray-700">Linked credit card / loan</span>
              <select
                required
                value={form.linked_credit_account}
                onChange={(e) =>
                  applyDebtAccountSelection(e.target.value ? Number(e.target.value) : "")
                }
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select account</option>
                {debtAccounts.map((a) => {
                  const usedBy = accountUsedByAnotherGoal(a.id, existingGoals, initial?.id);
                  const owed = creditBalanceOwed(a);
                  const suffix =
                    owed != null ? ` — ${formatCurrency(String(owed), a.currency)} owed` : "";
                  return (
                    <option key={a.id} value={a.id} disabled={usedBy != null}>
                      {getEffectiveDisplayName(a)}
                      {suffix}
                      {usedBy ? ` (used by ${usedBy})` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          {isDebt && form.linked_credit_account && (
            <p className="text-sm rounded-md bg-gray-50 border border-gray-200 px-3 py-2">
              <span className="text-gray-600">Balance owed as of today: </span>
              <span className="font-semibold text-gray-900">
                {debtBalanceOwedToday != null
                  ? formatCurrency(String(debtBalanceOwedToday), selectedDebtAccount?.currency)
                  : "—"}
              </span>
            </p>
          )}

          {isDebt && (
            <label className="block text-sm">
              <span className="text-gray-700">Starting debt amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.starting_debt_amount}
                onChange={(e) => setForm((f) => ({ ...f, starting_debt_amount: e.target.value }))}
                placeholder="Filled from account balance when you select a card"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          {isDebt && (
            <label className="block text-sm">
              <span className="text-gray-700">Payoff target</span>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.target_amount}
                onChange={(e) => setForm((f) => ({ ...f, target_amount: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="block text-sm">
            <span className="text-gray-700">Target date (optional)</span>
            <input
              type="date"
              value={form.target_date}
              onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          {!isDebt && (
            <label className="block text-sm">
              <span className="text-gray-700">Linked account (where money lives)</span>
              <select
                required
                value={form.linked_account}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    linked_account: e.target.value ? Number(e.target.value) : "",
                  }))
                }
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select account</option>
                {savingsAccounts.map((a) => {
                  const usedBy = accountUsedByAnotherGoal(a.id, existingGoals, initial?.id);
                  return (
                    <option key={a.id} value={a.id} disabled={usedBy != null}>
                      {getEffectiveDisplayName(a)}
                      {usedBy ? ` (used by ${usedBy})` : ""}
                    </option>
                  );
                })}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Deposits and withdrawals on this account update goal progress automatically.
              </p>
            </label>
          )}

          <label className="block text-sm">
            <span className="text-gray-700">Monthly target</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.monthly_contribution}
              onChange={(e) => setForm((f) => ({ ...f, monthly_contribution: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">Used for forecast pacing and as default transfer amount.</p>
          </label>

          {!isDebt && (
            <GoalFundingSection
              funding={form.funding}
              incomeRules={incomeRules}
              linkedAccountId={form.linked_account}
              monthlyTarget={form.monthly_contribution}
              rulesLoading={rulesLoading}
              onChange={(funding) => setForm((f) => ({ ...f, funding }))}
            />
          )}

          {fundingError && (
            <p className="text-sm text-red-600" role="alert">
              {fundingError}
            </p>
          )}

          <label className="block text-sm">
            <span className="text-gray-700">Priority (1 = highest)</span>
            <select
              value={form.priority}
              onChange={(e) =>
                setForm((f) => ({ ...f, priority: Number(e.target.value) }))
              }
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={1}>1 — Highest</option>
              <option value={2}>2 — High</option>
              <option value={3}>3 — Medium</option>
              <option value={4}>4 — Low</option>
              <option value={5}>5 — Lowest</option>
            </select>
          </label>

          <fieldset className="space-y-2 text-sm border border-gray-200 rounded-md p-3">
            <legend className="text-gray-700 font-medium px-1">Options</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.include_in_safe_to_spend}
                onChange={(e) =>
                  setForm((f) => ({ ...f, include_in_safe_to_spend: e.target.checked }))
                }
              />
              <span>Reduce safe-to-spend on linked account</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.forecast_enabled}
                onChange={(e) => setForm((f) => ({ ...f, forecast_enabled: e.target.checked }))}
              />
              <span>Include in forecast</span>
            </label>
          </fieldset>

          <label className="block text-sm">
            <span className="text-gray-700">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <input type="hidden" value={householdId} readOnly />

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : initial ? "Save changes" : "Create goal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
