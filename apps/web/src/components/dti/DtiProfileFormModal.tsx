import { useEffect, useId, useState } from "react";
import type { DtiProfile, DtiProfileWritePayload } from "@budget-app/shared";
import { normalizeProfileWritePayload, parseApiFieldErrors } from "../../lib/dtiForm";
import DtiModalFrame, { FieldError, fieldClass } from "./DtiModalFrame";

type Props = {
  open: boolean;
  initial: DtiProfile | null;
  saving: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (payload: DtiProfileWritePayload) => void;
};

export default function DtiProfileFormModal({
  open,
  initial,
  saving,
  error,
  onClose,
  onSubmit,
}: Props) {
  const titleId = useId();
  const [label, setLabel] = useState("");
  const [payment, setPayment] = useState("");
  const [includeHousing, setIncludeHousing] = useState(true);
  const [backEnd, setBackEnd] = useState("");
  const [frontEnd, setFrontEnd] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setLabel(initial?.current_housing_label ?? "");
    setPayment(initial?.current_housing_payment ?? "");
    setIncludeHousing(initial?.include_current_housing_in_current_dti ?? true);
    setBackEnd(initial?.target_back_end_dti_percent ?? "");
    setFrontEnd(initial?.target_front_end_dti_percent ?? "");
    setErrors({});
  }, [open, initial]);

  if (!open) return null;

  const api = error ? parseApiFieldErrors(error) : { form: "", fields: {} };
  const formError = error && !Object.keys(api.fields).length ? api.form : undefined;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = normalizeProfileWritePayload({
      current_housing_label: label,
      current_housing_payment: payment,
      include_current_housing_in_current_dti: includeHousing,
      target_back_end_dti_percent: backEnd,
      target_front_end_dti_percent: frontEnd,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onSubmit(result.payload);
  }

  return (
    <DtiModalFrame title="Housing and target settings" labelledBy={titleId} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-gray-600">
          Current housing may be rent or an existing mortgage payment. Proposed housing replaces this
          amount in the home-payment comparison.
        </p>
        <label className="block text-sm">
          <span className="text-gray-700">Current housing label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={fieldClass} />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Current monthly housing payment</span>
          <input
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
            inputMode="decimal"
            className={fieldClass}
            aria-invalid={Boolean(errors.current_housing_payment)}
          />
          <FieldError
            message={errors.current_housing_payment || api.fields.current_housing_payment}
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={includeHousing}
            onChange={(e) => setIncludeHousing(e.target.checked)}
          />
          <span>
            <span className="text-gray-800">Include current housing in current DTI</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Uncheck if you want current DTI to exclude this housing payment.
            </span>
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Target back-end DTI (%)</span>
          <input
            value={backEnd}
            onChange={(e) => setBackEnd(e.target.value)}
            inputMode="decimal"
            className={fieldClass}
            aria-invalid={Boolean(errors.target_back_end_dti_percent)}
          />
          <span className="mt-1 block text-xs text-gray-500">
            Planning preference only. Not an approval limit.
          </span>
          <FieldError
            message={errors.target_back_end_dti_percent || api.fields.target_back_end_dti_percent}
          />
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">Target front-end DTI (%, optional)</span>
          <input
            value={frontEnd}
            onChange={(e) => setFrontEnd(e.target.value)}
            inputMode="decimal"
            className={fieldClass}
          />
          <FieldError
            message={errors.target_front_end_dti_percent || api.fields.target_front_end_dti_percent}
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
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </DtiModalFrame>
  );
}
