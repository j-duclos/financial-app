import { useEffect, useId, useState } from "react";
import { DTI_INCOME_TYPES, type DtiIncomeSource, type DtiIncomeSourceWritePayload, type DtiIncomeType } from "@budget-app/shared";
import { INCOME_TYPE_LABELS } from "../../lib/dtiDisplay";
import { normalizeIncomeWritePayload, parseApiFieldErrors } from "../../lib/dtiForm";
import DtiModalFrame, { DtiFieldShell, describedByIds, fieldClass } from "./DtiModalFrame";

type Props = {
  open: boolean;
  householdId: number;
  initial: DtiIncomeSource | null;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: DtiIncomeSourceWritePayload) => void;
};

export default function DtiIncomeFormModal({
  open,
  householdId,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [incomeType, setIncomeType] = useState<DtiIncomeType>("employment");
  const [amount, setAmount] = useState("");
  const [included, setIncluded] = useState(true);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setIncomeType(initial?.income_type ?? "employment");
    setAmount(initial?.gross_monthly_amount ?? "");
    setIncluded(initial?.included ?? true);
    setNotes(initial?.notes ?? "");
    setErrors({});
  }, [open, initial]);

  if (!open) return null;

  const api = error ? parseApiFieldErrors(error) : { form: "", fields: {} };
  const formError = error && !Object.keys(api.fields).length ? api.form : undefined;
  const nameError = errors.name || api.fields.name;
  const amountError = errors.gross_monthly_amount || api.fields.gross_monthly_amount;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = normalizeIncomeWritePayload(householdId, {
      name,
      income_type: incomeType,
      gross_monthly_amount: amount,
      included,
      notes,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.payload);
  }

  return (
    <DtiModalFrame
      title={initial ? "Edit income source" : "Add income source"}
      labelledBy={titleId}
      onClose={onClose}
      busy={saving}
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-gray-600">
          Use gross income before taxes and deductions. Only include income you want modeled as
          qualifying income.
        </p>
        <DtiFieldShell id="dti-income-name" label="Name" errorId="dti-income-name-error" error={nameError}>
          <input
            id="dti-income-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
            aria-invalid={Boolean(nameError)}
            aria-describedby={describedByIds(nameError, "dti-income-name-error")}
          />
        </DtiFieldShell>
        <DtiFieldShell
          id="dti-income-type"
          label="Income type"
          errorId="dti-income-type-error"
          hint="Type is a label only. Inclusion decides whether it is used in DTI."
        >
          <select
            id="dti-income-type"
            value={incomeType}
            onChange={(e) => setIncomeType(e.target.value as DtiIncomeType)}
            className={fieldClass}
            aria-describedby="dti-income-type-hint"
          >
            {DTI_INCOME_TYPES.map((type) => (
              <option key={type} value={type}>
                {INCOME_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </DtiFieldShell>
        <DtiFieldShell
          id="dti-income-amount"
          label="Gross monthly amount"
          errorId="dti-income-amount-error"
          error={amountError}
        >
          <input
            id="dti-income-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className={fieldClass}
            aria-invalid={Boolean(amountError)}
            aria-describedby={describedByIds(amountError, "dti-income-amount-error")}
          />
        </DtiFieldShell>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={included}
            onChange={(e) => setIncluded(e.target.checked)}
          />
          <span>
            <span className="text-gray-800">Include in DTI calculation</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              When checked, this gross monthly amount is added to qualifying income.
            </span>
          </span>
        </label>
        <div className="block text-sm">
          <label htmlFor="dti-income-notes" className="text-gray-700">
            Notes (optional)
          </label>
          <textarea
            id="dti-income-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={fieldClass}
          />
        </div>
        {formError ? (
          <p className="text-sm text-red-600" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md min-h-[44px] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Add income source"}
          </button>
        </div>
      </form>
    </DtiModalFrame>
  );
}
