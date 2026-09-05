import { DTI_LOAN_TERM_YEARS, type PurchaseEstimateDraft, type PurchaseEstimateDraftErrors } from "../../lib/dtiProposedHome";
import { describedByIds, fieldClass, FieldError } from "./DtiModalFrame";

type Props = {
  draft: PurchaseEstimateDraft;
  errors: PurchaseEstimateDraftErrors;
  disabled?: boolean;
  onChange: (draft: PurchaseEstimateDraft) => void;
};

export default function DtiPurchaseEstimateForm({ draft, errors, disabled, onChange }: Props) {
  const downPaymentLabel =
    draft.down_payment_type === "percent" ? "Down payment percentage" : "Down payment amount";
  const termIsCustom =
    draft.custom_loan_term || !DTI_LOAN_TERM_YEARS.includes(Number(draft.loan_term_years) as (typeof DTI_LOAN_TERM_YEARS)[number]);

  return (
    <div className="space-y-3">
      <div className="block text-sm">
        <label htmlFor="dti-purchase-price" className="text-gray-700">
          Home purchase price
        </label>
        <input
          id="dti-purchase-price"
          value={draft.purchase_price}
          onChange={(e) => onChange({ ...draft, purchase_price: e.target.value })}
          inputMode="decimal"
          disabled={disabled}
          className={fieldClass}
          aria-invalid={Boolean(errors.purchase_price)}
          aria-describedby={describedByIds(errors.purchase_price, "dti-purchase-price-error", "dti-purchase-price-hint")}
        />
        <span id="dti-purchase-price-hint" className="mt-1 block text-xs text-gray-500">
          The agreed or estimated price of the home before the down payment.
        </span>
        <FieldError id="dti-purchase-price-error" message={errors.purchase_price} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm text-gray-700">Enter down payment as:</legend>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm min-h-[44px]">
            <input
              type="radio"
              name="dti-down-payment-type"
              checked={draft.down_payment_type === "dollars"}
              onChange={() => onChange({ ...draft, down_payment_type: "dollars" })}
              disabled={disabled}
            />
            Dollars
          </label>
          <label className="flex items-center gap-2 text-sm min-h-[44px]">
            <input
              type="radio"
              name="dti-down-payment-type"
              checked={draft.down_payment_type === "percent"}
              onChange={() => onChange({ ...draft, down_payment_type: "percent" })}
              disabled={disabled}
            />
            Percent
          </label>
        </div>
        <div className="block text-sm">
          <label htmlFor="dti-down-payment-value" className="text-gray-700">
            {downPaymentLabel}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="dti-down-payment-value"
              value={draft.down_payment_value}
              onChange={(e) => onChange({ ...draft, down_payment_value: e.target.value })}
              inputMode="decimal"
              disabled={disabled}
              className={fieldClass}
              aria-invalid={Boolean(errors.down_payment_value)}
              aria-describedby={describedByIds(errors.down_payment_value, "dti-down-payment-error")}
            />
            {draft.down_payment_type === "percent" ? (
              <span className="text-sm text-gray-600" aria-hidden="true">
                %
              </span>
            ) : null}
          </div>
          <FieldError id="dti-down-payment-error" message={errors.down_payment_value} />
        </div>
      </fieldset>

      <div className="block text-sm">
        <label htmlFor="dti-interest-rate" className="text-gray-700">
          Annual interest rate
        </label>
        <div className="flex items-center gap-2">
          <input
            id="dti-interest-rate"
            value={draft.annual_interest_rate}
            onChange={(e) => onChange({ ...draft, annual_interest_rate: e.target.value })}
            inputMode="decimal"
            placeholder="6.50"
            disabled={disabled}
            className={fieldClass}
            aria-invalid={Boolean(errors.annual_interest_rate)}
            aria-describedby={describedByIds(errors.annual_interest_rate, "dti-interest-rate-error")}
          />
          <span className="text-sm text-gray-600">%</span>
        </div>
        <FieldError id="dti-interest-rate-error" message={errors.annual_interest_rate} />
      </div>

      <div className="block text-sm">
        <label htmlFor="dti-loan-term" className="text-gray-700">
          Loan term
        </label>
        <select
          id="dti-loan-term"
          value={termIsCustom ? "custom" : draft.loan_term_years}
          onChange={(e) => {
            if (e.target.value === "custom") {
              onChange({ ...draft, custom_loan_term: true });
              return;
            }
            onChange({ ...draft, custom_loan_term: false, loan_term_years: e.target.value });
          }}
          disabled={disabled}
          className={fieldClass}
        >
          {DTI_LOAN_TERM_YEARS.map((years) => (
            <option key={years} value={years}>
              {years} years
            </option>
          ))}
          <option value="custom">Custom years</option>
        </select>
        {termIsCustom ? (
          <input
            id="dti-loan-term-custom"
            aria-label="Custom loan term in years"
            value={draft.loan_term_years}
            onChange={(e) => onChange({ ...draft, loan_term_years: e.target.value, custom_loan_term: true })}
            inputMode="numeric"
            disabled={disabled}
            className={fieldClass}
            aria-invalid={Boolean(errors.loan_term_years)}
            aria-describedby={describedByIds(errors.loan_term_years, "dti-loan-term-error")}
          />
        ) : null}
        <FieldError id="dti-loan-term-error" message={errors.loan_term_years} />
      </div>

      <div className="block text-sm">
        <label htmlFor="dti-annual-taxes" className="text-gray-700">
          Estimated annual property taxes
        </label>
        <input
          id="dti-annual-taxes"
          value={draft.annual_property_taxes}
          onChange={(e) => onChange({ ...draft, annual_property_taxes: e.target.value })}
          inputMode="decimal"
          disabled={disabled}
          className={fieldClass}
          aria-invalid={Boolean(errors.annual_property_taxes)}
          aria-describedby={describedByIds(
            errors.annual_property_taxes,
            "dti-annual-taxes-error",
            "dti-annual-taxes-hint"
          )}
        />
        <span id="dti-annual-taxes-hint" className="mt-1 block text-xs text-gray-500">
          Enter the estimated total for one year. The calculator will divide it into a monthly amount.
        </span>
        <FieldError id="dti-annual-taxes-error" message={errors.annual_property_taxes} />
      </div>

      <div className="block text-sm">
        <label htmlFor="dti-annual-insurance" className="text-gray-700">
          Estimated annual homeowners insurance
        </label>
        <input
          id="dti-annual-insurance"
          value={draft.annual_homeowners_insurance}
          onChange={(e) => onChange({ ...draft, annual_homeowners_insurance: e.target.value })}
          inputMode="decimal"
          disabled={disabled}
          className={fieldClass}
          aria-invalid={Boolean(errors.annual_homeowners_insurance)}
          aria-describedby={describedByIds(
            errors.annual_homeowners_insurance,
            "dti-annual-insurance-error",
            "dti-annual-insurance-hint"
          )}
        />
        <span id="dti-annual-insurance-hint" className="mt-1 block text-xs text-gray-500">
          Enter the estimated annual premium. The calculator will divide it into a monthly amount.
        </span>
        <FieldError id="dti-annual-insurance-error" message={errors.annual_homeowners_insurance} />
      </div>

      <div className="block text-sm">
        <label htmlFor="dti-monthly-mi" className="text-gray-700">
          Estimated monthly mortgage insurance
        </label>
        <input
          id="dti-monthly-mi"
          value={draft.monthly_mortgage_insurance}
          onChange={(e) => onChange({ ...draft, monthly_mortgage_insurance: e.target.value })}
          inputMode="decimal"
          disabled={disabled}
          className={fieldClass}
          aria-invalid={Boolean(errors.monthly_mortgage_insurance)}
          aria-describedby={describedByIds(
            errors.monthly_mortgage_insurance,
            "dti-monthly-mi-error",
            "dti-monthly-mi-hint"
          )}
        />
        <span id="dti-monthly-mi-hint" className="mt-1 block text-xs text-gray-500">
          Enter the lender’s estimated monthly PMI or mortgage-insurance amount, if applicable.
        </span>
        <FieldError id="dti-monthly-mi-error" message={errors.monthly_mortgage_insurance} />
      </div>

      <div className="block text-sm">
        <label htmlFor="dti-monthly-hoa" className="text-gray-700">
          Monthly HOA dues
        </label>
        <input
          id="dti-monthly-hoa"
          value={draft.monthly_hoa_dues}
          onChange={(e) => onChange({ ...draft, monthly_hoa_dues: e.target.value })}
          inputMode="decimal"
          disabled={disabled}
          className={fieldClass}
          aria-invalid={Boolean(errors.monthly_hoa_dues)}
          aria-describedby={describedByIds(errors.monthly_hoa_dues, "dti-monthly-hoa-error")}
        />
        <FieldError id="dti-monthly-hoa-error" message={errors.monthly_hoa_dues} />
      </div>

      <div className="block text-sm">
        <label htmlFor="dti-monthly-other" className="text-gray-700">
          Other required monthly housing costs
        </label>
        <input
          id="dti-monthly-other"
          value={draft.other_required_monthly_housing_costs}
          onChange={(e) => onChange({ ...draft, other_required_monthly_housing_costs: e.target.value })}
          inputMode="decimal"
          disabled={disabled}
          className={fieldClass}
          aria-invalid={Boolean(errors.other_required_monthly_housing_costs)}
          aria-describedby={describedByIds(
            errors.other_required_monthly_housing_costs,
            "dti-monthly-other-error",
            "dti-monthly-other-hint"
          )}
        />
        <span id="dti-monthly-other-hint" className="mt-1 block text-xs text-gray-500">
          Include only recurring monthly costs required for the property or loan.
        </span>
        <FieldError id="dti-monthly-other-error" message={errors.other_required_monthly_housing_costs} />
      </div>
    </div>
  );
}
