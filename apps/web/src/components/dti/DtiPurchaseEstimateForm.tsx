import { formatCurrency } from "@budget-app/shared";
import {
  DTI_LOAN_TERM_YEARS,
  LOAN_ESTIMATE_FHA,
  LOAN_ESTIMATE_FIXED_RATE_MANUAL,
  LOAN_ESTIMATE_TYPE_LABELS,
  type PurchaseEstimateDraft,
  type PurchaseEstimateDraftErrors,
} from "../../lib/dtiProposedHome";
import { describedByIds, fieldClass, FieldError, FieldInfo } from "./DtiModalFrame";

function LabelWithInfo({
  htmlFor,
  text,
  info,
}: {
  htmlFor: string;
  text: string;
  info?: string;
}) {
  return (
    <div className="inline-flex items-center">
      <label htmlFor={htmlFor} className="text-gray-700">
        {text}
      </label>
      {info ? <FieldInfo label={info} /> : null}
    </div>
  );
}

type Props = {
  draft: PurchaseEstimateDraft;
  errors: PurchaseEstimateDraftErrors;
  disabled?: boolean;
  convertedDownPayment?: { amount: string; percent: string } | null;
  onChange: (draft: PurchaseEstimateDraft) => void;
};

export default function DtiPurchaseEstimateForm({
  draft,
  errors,
  disabled,
  convertedDownPayment,
  onChange,
}: Props) {
  const downPaymentLabel =
    draft.down_payment_type === "percent" ? "Down payment percentage" : "Down payment amount";
  const termIsCustom =
    draft.custom_loan_term ||
    !DTI_LOAN_TERM_YEARS.includes(Number(draft.loan_term_years) as (typeof DTI_LOAN_TERM_YEARS)[number]);
  const isFha = draft.loan_estimate_type === LOAN_ESTIMATE_FHA;

  return (
    <div className="space-y-4 min-w-0">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-900">Purchase and financing</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
          <div className="block text-sm min-w-0">
            <LabelWithInfo
              htmlFor="dti-purchase-price"
              text="Home purchase price"
              info="The agreed or estimated price of the home before the down payment."
            />
            <input
              id="dti-purchase-price"
              value={draft.purchase_price}
              onChange={(e) => onChange({ ...draft, purchase_price: e.target.value })}
              inputMode="decimal"
              disabled={disabled}
              className={fieldClass}
              aria-invalid={Boolean(errors.purchase_price)}
              aria-describedby={describedByIds(errors.purchase_price, "dti-purchase-price-error")}
            />
            <FieldError id="dti-purchase-price-error" message={errors.purchase_price} />
          </div>

          <div className="block text-sm min-w-0">
            <fieldset>
              <legend className="text-gray-700">Down payment</legend>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm min-h-[44px]">
                  <input
                    type="radio"
                    name="dti-down-payment-type"
                    value="dollars"
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
                    value="percent"
                    checked={draft.down_payment_type === "percent"}
                    onChange={() => onChange({ ...draft, down_payment_type: "percent" })}
                    disabled={disabled}
                  />
                  Percent
                </label>
              </div>
            </fieldset>
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
            {convertedDownPayment ? (
              <p className="mt-1 text-xs text-gray-600" data-testid="dti-down-payment-converted">
                Down payment: {formatCurrency(convertedDownPayment.amount)} ({convertedDownPayment.percent}%)
              </p>
            ) : null}
          </div>

          <div className="block text-sm min-w-0">
            <LabelWithInfo
              htmlFor="dti-interest-rate"
              text="Annual interest rate"
              info="Required. Enter the estimated annual rate. An empty field is not treated as 0%."
            />
            <div className="flex items-center gap-2">
              <input
                id="dti-interest-rate"
                value={draft.annual_interest_rate}
                onChange={(e) => onChange({ ...draft, annual_interest_rate: e.target.value })}
                inputMode="decimal"
                required
                aria-required="true"
                disabled={disabled}
                className={fieldClass}
                aria-invalid={Boolean(errors.annual_interest_rate)}
                aria-describedby={describedByIds(errors.annual_interest_rate, "dti-interest-rate-error")}
              />
              <span className="text-sm text-gray-600">%</span>
            </div>
            <FieldError id="dti-interest-rate-error" message={errors.annual_interest_rate} />
          </div>

          <div className="block text-sm min-w-0">
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
                onChange={(e) =>
                  onChange({ ...draft, loan_term_years: e.target.value, custom_loan_term: true })
                }
                inputMode="numeric"
                disabled={disabled}
                className={fieldClass}
                aria-invalid={Boolean(errors.loan_term_years)}
                aria-describedby={describedByIds(errors.loan_term_years, "dti-loan-term-error")}
              />
            ) : null}
            <FieldError id="dti-loan-term-error" message={errors.loan_term_years} />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm text-gray-700">Loan estimate type</legend>
          <div className="grid grid-cols-1 gap-1 mt-1">
            <label className="flex items-start gap-2 text-sm min-h-[44px]">
              <input
                type="radio"
                name="dti-loan-estimate-type"
                value={LOAN_ESTIMATE_FHA}
                className="mt-1"
                checked={isFha}
                onChange={() => onChange({ ...draft, loan_estimate_type: LOAN_ESTIMATE_FHA })}
                disabled={disabled}
              />
              <span>{LOAN_ESTIMATE_TYPE_LABELS.fha}</span>
            </label>
            <label className="flex items-start gap-2 text-sm min-h-[44px]">
              <input
                type="radio"
                name="dti-loan-estimate-type"
                value={LOAN_ESTIMATE_FIXED_RATE_MANUAL}
                className="mt-1"
                checked={!isFha}
                onChange={() =>
                  onChange({ ...draft, loan_estimate_type: LOAN_ESTIMATE_FIXED_RATE_MANUAL })
                }
                disabled={disabled}
              />
              <span>{LOAN_ESTIMATE_TYPE_LABELS.fixed_rate_manual}</span>
            </label>
          </div>
        </fieldset>

        {isFha ? (
          <label className="flex items-start gap-2 text-sm min-h-[44px]">
            <input
              type="checkbox"
              className="mt-1"
              checked={draft.finance_upfront_mip}
              onChange={(e) => onChange({ ...draft, finance_upfront_mip: e.target.checked })}
              disabled={disabled}
            />
            <span>
              Finance FHA upfront MIP
              <span className="block text-xs text-gray-500">
                When checked, upfront MIP is added to the loan amount used for principal and interest.
                Uncheck to treat it as a closing cost.
              </span>
            </span>
          </label>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-900">Estimated ownership costs</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
          <div className="block text-sm min-w-0">
            <LabelWithInfo
              htmlFor="dti-annual-taxes"
              text="Annual property taxes"
              info="Enter the estimated total for one year. The calculator divides it into a monthly amount."
            />
            <input
              id="dti-annual-taxes"
              value={draft.annual_property_taxes}
              onChange={(e) => onChange({ ...draft, annual_property_taxes: e.target.value })}
              inputMode="decimal"
              disabled={disabled}
              className={fieldClass}
              aria-invalid={Boolean(errors.annual_property_taxes)}
              aria-describedby={describedByIds(errors.annual_property_taxes, "dti-annual-taxes-error")}
            />
            <FieldError id="dti-annual-taxes-error" message={errors.annual_property_taxes} />
          </div>

          <div className="block text-sm min-w-0">
            <LabelWithInfo
              htmlFor="dti-annual-insurance"
              text="Annual homeowners insurance"
              info="Enter the estimated annual premium. The calculator divides it into a monthly amount."
            />
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
                "dti-annual-insurance-error"
              )}
            />
            <FieldError id="dti-annual-insurance-error" message={errors.annual_homeowners_insurance} />
          </div>

          <div className="block text-sm min-w-0">
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

          <div className="block text-sm min-w-0">
            <LabelWithInfo
              htmlFor="dti-monthly-other"
              text="Other required monthly housing costs"
              info="Include only recurring monthly costs required for the property or loan."
            />
            <input
              id="dti-monthly-other"
              value={draft.other_required_monthly_housing_costs}
              onChange={(e) =>
                onChange({ ...draft, other_required_monthly_housing_costs: e.target.value })
              }
              inputMode="decimal"
              disabled={disabled}
              className={fieldClass}
              aria-invalid={Boolean(errors.other_required_monthly_housing_costs)}
              aria-describedby={describedByIds(
                errors.other_required_monthly_housing_costs,
                "dti-monthly-other-error"
              )}
            />
            <FieldError
              id="dti-monthly-other-error"
              message={errors.other_required_monthly_housing_costs}
            />
          </div>

          {!isFha ? (
            <div className="block text-sm min-w-0 sm:col-span-2">
              <LabelWithInfo
                htmlFor="dti-monthly-mi"
                text="Monthly mortgage insurance"
                info="Enter the lender’s estimated monthly PMI or mortgage-insurance amount, if applicable."
              />
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
                  "dti-monthly-mi-error"
                )}
              />
              <FieldError id="dti-monthly-mi-error" message={errors.monthly_mortgage_insurance} />
            </div>
          ) : null}
        </div>
      </fieldset>
    </div>
  );
}
