import { useEffect, useMemo, useState } from "react";
import type { Account, RecurringRule, ScenarioOneTimeEvent, ScenarioRuleOverride } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  createScenarioOneTimeEvent,
  updateScenarioOneTimeEvent,
  createScenarioOverride,
  updateScenarioOverride,
} from "@budget-app/api-client";
import { formatDateDisplay } from "../../lib/dateDisplay";
import {
  type DebtPaymentType,
  DEBT_OVERRIDE_NOTE,
  debtEventNote,
  filterAssetAccounts,
  filterDebtAccounts,
  findDebtPaymentRules,
  formatDebtBalance,
  formatUtilizationLine,
  isDebtPaymentOverride,
  isDebtScenarioEvent,
  monthlyIncreaseSummary,
  oneTimeDebtDescription,
  parseDebtEventType,
  projectedUtilizationAfterPayment,
  utilizationPercent,
} from "../../lib/scenarioDebtPayment";
import { balanceOwed } from "../../lib/paymentPlannerDisplay";

type Props = {
  scenarioId: number;
  accounts: Account[];
  rules: RecurringRule[];
  existingEvent?: ScenarioOneTimeEvent | null;
  existingOverride?: ScenarioRuleOverride | null;
  onClose: () => void;
  onSaved: () => void;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-sm text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

const PAYMENT_TYPES: { id: DebtPaymentType; title: string; hint: string }[] = [
  {
    id: "one_time",
    title: "One-Time Payment",
    hint: "Extra payment on a specific date",
  },
  {
    id: "pay_full",
    title: "Pay Full Balance",
    hint: "Pay off the entire balance at once",
  },
  {
    id: "monthly_increase",
    title: "Increase Monthly Payment",
    hint: "Raise your recurring payment amount",
  },
];

export default function PayDownDebtModal({
  scenarioId,
  accounts,
  rules,
  existingEvent,
  existingOverride,
  onClose,
  onSaved,
}: Props) {
  const assetAccounts = useMemo(() => filterAssetAccounts(accounts), [accounts]);
  const debtAccounts = useMemo(() => filterDebtAccounts(accounts), [accounts]);

  const editing = !!(existingEvent || existingOverride);

  const initialType = useMemo((): DebtPaymentType => {
    if (existingOverride && isDebtPaymentOverride(existingOverride)) return "monthly_increase";
    if (existingEvent && isDebtScenarioEvent(existingEvent)) {
      const parsed = parseDebtEventType(existingEvent);
      if (parsed === "pay_full" || parsed === "one_time") return parsed;
    }
    return "one_time";
  }, [existingEvent, existingOverride]);

  const [paymentType, setPaymentType] = useState<DebtPaymentType>(initialType);
  const [date, setDate] = useState(existingEvent?.date ?? todayIso());
  const [sourceAccountId, setSourceAccountId] = useState<number | "">(
    existingEvent?.account?.id ?? existingEvent?.account_id ?? ""
  );
  const [debtAccountId, setDebtAccountId] = useState<number | "">(
    existingEvent?.transfer_to_account?.id ??
      existingEvent?.transfer_to_account_id ??
      existingOverride?.rule?.transfer_to_account?.id ??
      existingOverride?.rule?.transfer_to_account_id ??
      ""
  );
  const [amount, setAmount] = useState(existingEvent?.amount ?? "");
  const [amountTouched, setAmountTouched] = useState(!!existingEvent);
  const [notes, setNotes] = useState(existingEvent?.notes?.replace(/^what_if_debt:\w+\s*/, "") ?? "");
  const [ruleId, setRuleId] = useState<number | "">(existingOverride?.rule?.id ?? "");
  const [newMonthlyAmount, setNewMonthlyAmount] = useState(existingOverride?.override_amount ?? "");
  const [effectiveDate, setEffectiveDate] = useState(
    existingOverride?.override_start_date ?? todayIso()
  );
  const [monthlyNotes, setMonthlyNotes] = useState(
    existingOverride?.notes?.replace(DEBT_OVERRIDE_NOTE, "").trim() ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
  const debtAccount = accounts.find((a) => a.id === debtAccountId);
  const debtRules = useMemo(
    () =>
      debtAccountId ? findDebtPaymentRules(rules, debtAccountId as number, accounts) : [],
    [rules, debtAccountId, accounts]
  );
  const selectedRule = debtRules.find((r) => r.id === ruleId) ?? debtRules[0];

  useEffect(() => {
    if (paymentType !== "pay_full" || amountTouched || !debtAccount) return;
    const owed = balanceOwed(debtAccount);
    if (owed != null && owed > 0) setAmount(String(owed));
  }, [paymentType, debtAccount, amountTouched]);

  useEffect(() => {
    if (debtAccountId && debtRules.length === 1 && ruleId === "") {
      setRuleId(debtRules[0].id);
    }
  }, [debtAccountId, debtRules, ruleId]);

  const summaryPreview = useMemo(() => {
    const debtName = debtAccount?.name ?? "debt account";
    const sourceName = sourceAccount?.name ?? "source account";
    if (paymentType === "monthly_increase") {
      if (!selectedRule || !newMonthlyAmount.trim()) return null;
      return monthlyIncreaseSummary(
        debtName,
        selectedRule.amount,
        newMonthlyAmount,
        selectedRule.currency ?? "USD",
        effectiveDate
      );
    }
    if (!sourceAccountId || !debtAccountId) return null;
    if (paymentType === "pay_full") {
      return oneTimeDebtDescription("pay_full", sourceName, debtName);
    }
    if (!amount.trim()) return null;
    const when = formatDateDisplay(date);
    return `${sourceName} → ${debtName}: ${formatCurrency(amount, "USD")} on ${when}`;
  }, [
    paymentType,
    sourceAccount,
    debtAccount,
    sourceAccountId,
    debtAccountId,
    amount,
    date,
    selectedRule,
    newMonthlyAmount,
    effectiveDate,
  ]);

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    try {
      if (paymentType === "monthly_increase") {
        if (!debtAccountId || !ruleId || !newMonthlyAmount.trim() || !effectiveDate) {
          setError("Choose a debt account, payment rule, new amount, and effective date.");
          return;
        }
        const noteParts = [DEBT_OVERRIDE_NOTE, monthlyNotes.trim()].filter(Boolean);
        const body = {
          rule_id: ruleId as number,
          override_amount: String(Math.abs(parseFloat(newMonthlyAmount))),
          override_active: true as const,
          override_start_date: effectiveDate,
          override_end_date: null as string | null,
          override_account_id: null as number | null,
          override_category_id: null as number | null,
          notes: noteParts.join(" ").trim(),
        };
        if (existingOverride) {
          await updateScenarioOverride(existingOverride.id, body);
        } else {
          await createScenarioOverride(scenarioId, body);
        }
      } else {
        if (!date || !sourceAccountId || !debtAccountId || !amount.trim()) {
          setError("Fill in date, accounts, and payment amount.");
          return;
        }
        if (sourceAccountId === debtAccountId) {
          setError("Source and debt accounts must be different.");
          return;
        }
        const debtName = debtAccount?.name ?? "debt";
        const sourceName = sourceAccount?.name ?? "account";
        const description = oneTimeDebtDescription(
          paymentType === "pay_full" ? "pay_full" : "one_time",
          sourceName,
          debtName
        );
        const body = {
          date,
          account_id: sourceAccountId as number,
          transfer_to_account_id: debtAccountId as number,
          description,
          direction: "TRANSFER" as const,
          amount: String(Math.abs(parseFloat(amount))),
          category_id: null,
          notes: [debtEventNote(paymentType === "pay_full" ? "pay_full" : "one_time"), notes.trim()]
            .filter(Boolean)
            .join(" "),
        };
        if (existingEvent) {
          await updateScenarioOneTimeEvent(existingEvent.id, body);
        } else {
          await createScenarioOneTimeEvent(scenarioId, body);
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save debt change");
    } finally {
      setSaving(false);
    }
  }

  const owedDisplay = formatDebtBalance(debtAccount);
  const utilBefore = formatUtilizationLine(debtAccount);
  const paymentNum = parseFloat(amount);
  const utilAfter =
    debtAccount && !Number.isNaN(paymentNum) && paymentNum > 0
      ? projectedUtilizationAfterPayment(debtAccount, paymentNum)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pay-down-debt-title"
      >
        <h3 id="pay-down-debt-title" className="font-medium text-gray-900 mb-1">
          {editing ? "Edit debt payment" : "Pay down debt"}
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Model paying down debt — moves cash from a bank account to reduce what you owe. This is not
          an expense.
        </p>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <fieldset className="space-y-2 mb-4">
          <legend className="text-sm font-medium text-gray-800 mb-1">Payment type</legend>
          {PAYMENT_TYPES.map((opt) => (
            <label
              key={opt.id}
              className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                paymentType === opt.id
                  ? "border-blue-500 bg-blue-50/60"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="debt-payment-type"
                value={opt.id}
                checked={paymentType === opt.id}
                onChange={() => {
                  setPaymentType(opt.id);
                  setAmountTouched(false);
                }}
                className="mt-0.5 shrink-0"
              />
              <span>
                <span className="block text-sm font-medium text-gray-900">{opt.title}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{opt.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {paymentType === "monthly_increase" ? (
          <>
            <Field label="Debt account">
              <select
                value={debtAccountId}
                onChange={(e) => {
                  setDebtAccountId(e.target.value === "" ? "" : Number(e.target.value));
                  setRuleId("");
                }}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {debtAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>

            {debtAccount && (
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 mb-3 text-sm">
                <p className="text-gray-600">
                  Current monthly payment:{" "}
                  <span className="font-medium text-gray-900">
                    {selectedRule
                      ? `${formatCurrency(selectedRule.amount, selectedRule.currency)}/month`
                      : debtRules.length === 0
                        ? "No matching payment rule — in Rules, set category to Credit Card Payment and link Pay to account"
                        : "—"}
                  </span>
                </p>
              </div>
            )}

            {debtRules.length > 1 && (
              <Field label="Payment to change">
                <select
                  value={ruleId}
                  onChange={(e) => setRuleId(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">—</option>
                  {debtRules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({formatCurrency(r.amount, r.currency)})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="New monthly payment">
              <input
                type="number"
                step="0.01"
                min="0"
                value={newMonthlyAmount}
                onChange={(e) => setNewMonthlyAmount(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Effective date">
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Notes (optional)">
              <input
                type="text"
                value={monthlyNotes}
                onChange={(e) => setMonthlyNotes(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm"
                placeholder="Why you're increasing payments"
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Source account">
              <select
                value={sourceAccountId}
                onChange={(e) =>
                  setSourceAccountId(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.id === debtAccountId}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Checking, savings, or cash only</p>
            </Field>
            <Field label="Debt account">
              <select
                value={debtAccountId}
                onChange={(e) => {
                  setDebtAccountId(e.target.value === "" ? "" : Number(e.target.value));
                  setAmountTouched(false);
                }}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                {debtAccounts.map((a) => (
                  <option key={a.id} value={a.id} disabled={a.id === sourceAccountId}>
                    {a.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Credit card or loan</p>
            </Field>

            {debtAccount && (
              <div className="rounded-lg bg-indigo-50/80 border border-indigo-100 px-3 py-2 mb-3 text-sm">
                <p className="text-indigo-900">
                  Current debt balance: <span className="font-semibold">{owedDisplay}</span>
                </p>
                {utilBefore && (
                  <p className="text-indigo-800 text-xs mt-1">Utilization: {utilBefore}</p>
                )}
              </div>
            )}

            <Field label="Payment amount">
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountTouched(true);
                }}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
              {paymentType === "pay_full" && (
                <p className="text-xs text-gray-500 mt-1">
                  Prefilled from current balance — adjust if needed
                </p>
              )}
            </Field>

            {utilBefore != null && utilAfter != null && paymentType !== "pay_full" && (
              <p className="text-xs text-gray-600 -mt-1 mb-3">
                After payment, utilization ≈ {utilAfter}%
              </p>
            )}
            {paymentType === "pay_full" && utilAfter === 0 && (
              <p className="text-xs text-emerald-800 -mt-1 mb-3">Utilization becomes 0%</p>
            )}

            <Field label="Notes (optional)">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </Field>
          </>
        )}

        {summaryPreview && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 mb-4">
            <p className="text-xs font-medium text-blue-900 uppercase tracking-wide mb-1">
              In this plan
            </p>
            <p className="text-sm text-blue-950">{summaryPreview}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {editing ? "Save" : "Add to plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
