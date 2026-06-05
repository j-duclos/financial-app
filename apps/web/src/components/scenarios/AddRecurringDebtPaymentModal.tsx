import { useMemo, useState } from "react";
import type { Account, ScenarioAddedRecurring } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  createScenarioAddedRecurring,
  updateScenarioAddedRecurring,
} from "@budget-app/api-client";
import {
  buildTwiceMonthlyNotes,
  DEBT_RECURRING_NOTE,
  filterAssetAccounts,
  filterDebtAccounts,
  formatDebtBalance,
  formatUtilizationLine,
  parseTwiceMonthlyDays,
  projectedUtilizationAfterPayment,
  recurringDebtFrequencyLabel,
} from "../../lib/scenarioDebtPayment";

type RecurringPaymentFrequency = "WEEKLY" | "BIWEEKLY" | "TWICE_MONTHLY" | "MONTHLY_DAY";

type Props = {
  scenarioId: number;
  accounts: Account[];
  existing?: ScenarioAddedRecurring | null;
  onClose: () => void;
  onSaved: () => void;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekdayFromIso(iso: string): number {
  const d = new Date(`${iso}T12:00:00`);
  return (d.getDay() + 6) % 7;
}

function dayOfMonthFromIso(iso: string): number {
  return Number(iso.slice(8, 10)) || 1;
}

const FREQUENCY_OPTIONS: { id: RecurringPaymentFrequency; label: string }[] = [
  { id: "WEEKLY", label: "Weekly" },
  { id: "BIWEEKLY", label: "Every 2 Weeks" },
  { id: "TWICE_MONTHLY", label: "Twice Monthly" },
  { id: "MONTHLY_DAY", label: "Monthly" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="block text-sm text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function AddRecurringDebtPaymentModal({
  scenarioId,
  accounts,
  existing,
  onClose,
  onSaved,
}: Props) {
  const assetAccounts = useMemo(() => filterAssetAccounts(accounts), [accounts]);
  const debtAccounts = useMemo(() => filterDebtAccounts(accounts), [accounts]);

  const parsedTwice = parseTwiceMonthlyDays(existing?.notes);
  const [name, setName] = useState(existing?.name ?? "");
  const [sourceAccountId, setSourceAccountId] = useState<number | "">(
    existing?.account?.id ?? existing?.account_id ?? ""
  );
  const [destAccountId, setDestAccountId] = useState<number | "">(
    existing?.transfer_to_account?.id ?? existing?.transfer_to_account_id ?? ""
  );
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [frequency, setFrequency] = useState<RecurringPaymentFrequency>(() => {
    if (parsedTwice) return "TWICE_MONTHLY";
    const f = existing?.frequency;
    if (f === "WEEKLY" || f === "BIWEEKLY" || f === "MONTHLY_DAY") return f;
    return "MONTHLY_DAY";
  });
  const [twiceDay1, setTwiceDay1] = useState(parsedTwice?.[0] ?? 1);
  const [twiceDay2, setTwiceDay2] = useState(parsedTwice?.[1] ?? 15);
  const [startDate, setStartDate] = useState(existing?.start_date ?? todayIso());
  const [endDate, setEndDate] = useState(existing?.end_date ?? "");
  const [notes, setNotes] = useState(
    existing?.notes?.replace(DEBT_RECURRING_NOTE, "").replace(/twice_monthly_days=\d{1,2},\d{1,2}/, "").trim() ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
  const destAccount = accounts.find((a) => a.id === destAccountId);
  const owedDisplay = formatDebtBalance(destAccount);
  const utilBefore = formatUtilizationLine(destAccount);
  const paymentNum = parseFloat(amount);
  const utilAfter =
    destAccount && !Number.isNaN(paymentNum) && paymentNum > 0
      ? projectedUtilizationAfterPayment(destAccount, paymentNum)
      : null;

  const summaryPreview = useMemo(() => {
    if (!name.trim() || !sourceAccountId || !destAccountId || !amount.trim()) return null;
    const freqNotes =
      frequency === "TWICE_MONTHLY"
        ? buildTwiceMonthlyNotes(twiceDay1, twiceDay2, "")
        : `${DEBT_RECURRING_NOTE}`;
    const freqLabel = recurringDebtFrequencyLabel(
      frequency === "TWICE_MONTHLY" ? "MONTHLY_DAY" : frequency,
      freqNotes
    );
    return `${name.trim()}: ${formatCurrency(amount, "USD")} ${freqLabel}\n${sourceAccount?.name ?? "Source"} → ${destAccount?.name ?? "Debt"}`;
  }, [
    name,
    amount,
    frequency,
    sourceAccount,
    destAccount,
    sourceAccountId,
    destAccountId,
    twiceDay1,
    twiceDay2,
  ]);

  async function handleSubmit() {
    setError(null);
    if (!name.trim() || !sourceAccountId || !destAccountId || !amount.trim() || !startDate) {
      setError("Fill in payment name, accounts, amount, and start date.");
      return;
    }
    if (sourceAccountId === destAccountId) {
      setError("Source and destination must be different accounts.");
      return;
    }

    const apiFrequency =
      frequency === "TWICE_MONTHLY" ? ("MONTHLY_DAY" as const) : frequency;
    const noteBody =
      frequency === "TWICE_MONTHLY"
        ? buildTwiceMonthlyNotes(twiceDay1, twiceDay2, notes)
        : [DEBT_RECURRING_NOTE, notes.trim()].filter(Boolean).join(" ");

    const body = {
      name: name.trim(),
      account_id: sourceAccountId as number,
      transfer_to_account_id: destAccountId as number,
      direction: "TRANSFER" as const,
      amount: String(Math.abs(parseFloat(amount))),
      currency: "USD",
      frequency: apiFrequency,
      interval: 1,
      day_of_week: frequency === "WEEKLY" || frequency === "BIWEEKLY" ? weekdayFromIso(startDate) : null,
      day_of_month:
        frequency === "MONTHLY_DAY" || frequency === "TWICE_MONTHLY"
          ? dayOfMonthFromIso(startDate)
          : null,
      start_date: startDate,
      end_date: endDate.trim() || null,
      category_id: null,
      notes: noteBody,
    };

    setSaving(true);
    try {
      if (existing) {
        await updateScenarioAddedRecurring(existing.id, body);
      } else {
        await createScenarioAddedRecurring(scenarioId, body);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save recurring payment");
    } finally {
      setSaving(false);
    }
  }

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
        aria-labelledby="add-recurring-debt-title"
      >
        <h3 id="add-recurring-debt-title" className="font-medium text-gray-900 mb-1">
          {existing ? "Edit recurring payment" : "Add Recurring Payment"}
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Extra payments toward debt in this plan only — reduces cash and card balance without
          counting as spending.
        </p>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <Field label="Payment name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Extra Venture Payment"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </Field>

        <Field label="Source account">
          <select
            value={sourceAccountId}
            onChange={(e) => setSourceAccountId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {assetAccounts.map((a) => (
              <option key={a.id} value={a.id} disabled={a.id === destAccountId}>
                {a.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">Checking, savings, or cash</p>
        </Field>

        <Field label="Destination account">
          <select
            value={destAccountId}
            onChange={(e) => setDestAccountId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {debtAccounts.map((a) => (
              <option key={a.id} value={a.id} disabled={a.id === sourceAccountId}>
                {a.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">Credit card, loan, or line of credit</p>
        </Field>

        {destAccount && (
          <div className="rounded-lg bg-indigo-50/80 border border-indigo-100 px-3 py-2 mb-3 text-sm">
            <p className="text-indigo-900">
              Current debt balance: <span className="font-semibold">{owedDisplay}</span>
            </p>
            {utilBefore && (
              <p className="text-indigo-800 text-xs mt-1">Utilization: {utilBefore}</p>
            )}
          </div>
        )}

        <Field label="Amount">
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          {utilBefore != null && utilAfter != null && amount.trim() && (
            <p className="text-xs text-gray-600 mt-1">
              After each payment, utilization ≈ {utilAfter}%
            </p>
          )}
        </Field>

        <Field label="Frequency">
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as RecurringPaymentFrequency)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </Field>

        {frequency === "TWICE_MONTHLY" && (
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Field label="Day of month (1st)">
              <input
                type="number"
                min={1}
                max={31}
                value={twiceDay1}
                onChange={(e) => setTwiceDay1(Number(e.target.value))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Day of month (2nd)">
              <input
                type="number"
                min={1}
                max={31}
                value={twiceDay2}
                onChange={(e) => setTwiceDay2(Number(e.target.value))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="End date (optional)">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-sm"
            />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-sm"
          />
        </Field>

        {summaryPreview && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 mb-4">
            <p className="text-xs font-medium text-blue-900 uppercase tracking-wide mb-1">
              In this plan
            </p>
            <p className="text-sm text-blue-950 whitespace-pre-line">{summaryPreview}</p>
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
            {existing ? "Save" : "Add to plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
