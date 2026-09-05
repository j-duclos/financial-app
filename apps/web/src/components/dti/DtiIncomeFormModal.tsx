import { useEffect, useId, useState } from "react";
import { DTI_INCOME_TYPES, type DtiIncomeSource, type DtiIncomeSourceWritePayload, type DtiIncomeType } from "@budget-app/shared";
import { INCOME_TYPE_LABELS } from "../../lib/dtiDisplay";
import { normalizeIncomeWritePayload, parseApiFieldErrors } from "../../lib/dtiForm";
import DtiModalFrame, { FieldError, fieldClass } from "./DtiModalFrame";

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
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-gray-600">
          Use gross income before taxes and deductions. Only include income you want modeled as
          qualifying income.
        </p>
        <label className="block text-sm">
          <span className="text-gray-700">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={fieldClass}
            aria-invalid={Boolean(errors.name || api.fields.name)}
            aria-describedby={errors.name ? "dti-income-name-error" : undefined}
          />
          <FieldError id="dti-income-name-error" message={errors.name || api.fields.name} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Income type</span>
          <select
            value={incomeType}
            onChange={(e) => setIncomeType(e.target.value as DtiIncomeType)}
            className={fieldClass}
          >
            {DTI_INCOME_TYPES.map((type) => (
              <option key={type} value={type}>
                {INCOME_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-gray-500">
            Type is a label only. Inclusion decides whether it is used in DTI.
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Gross monthly amount</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className={fieldClass}
            aria-invalid={Boolean(errors.gross_monthly_amount || api.fields.gross_monthly_amount)}
          />
          <FieldError message={errors.gross_monthly_amount || api.fields.gross_monthly_amount} />
        </label>
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
        <label className="block text-sm">
          <span className="text-gray-700">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={fieldClass}
          />
        </label>
        {formError ? (
          <p className="text-sm text-red-600" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md min-h-[44px]"
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
