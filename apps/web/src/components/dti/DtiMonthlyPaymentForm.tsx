import { PROPOSED_HOUSING_FIELDS, type ProposedHousingDraft } from "../../lib/dtiForm";
import { MONTHLY_PAYMENT_FIELD_COPY } from "../../lib/dtiProposedHome";
import { describedByIds, fieldClass, FieldError } from "./DtiModalFrame";

type Props = {
  draft: ProposedHousingDraft;
  errors: Partial<ProposedHousingDraft>;
  disabled?: boolean;
  onChange: (draft: ProposedHousingDraft) => void;
};

export default function DtiMonthlyPaymentForm({ draft, errors, disabled, onChange }: Props) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Enter each part of the estimated monthly housing payment. Do not enter the home price or loan
        balance here.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
        {PROPOSED_HOUSING_FIELDS.map((field) => {
          const fieldId = `dti-proposed-${field}`;
          const errorId = `${fieldId}-error`;
          const hintId = `${fieldId}-hint`;
          const error = errors[field];
          const copy = MONTHLY_PAYMENT_FIELD_COPY[field];
          return (
            <div key={field} className="block text-sm">
              <label htmlFor={fieldId} className="text-gray-700">
                {copy.label}
              </label>
              <input
                id={fieldId}
                value={draft[field]}
                onChange={(e) => onChange({ ...draft, [field]: e.target.value })}
                inputMode="decimal"
                disabled={disabled}
                className={fieldClass}
                aria-invalid={Boolean(error)}
                aria-describedby={describedByIds(error, errorId, hintId)}
              />
              <span id={hintId} className="mt-1 block text-xs text-gray-500">
                {copy.hint}
              </span>
              <FieldError id={errorId} message={error} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
