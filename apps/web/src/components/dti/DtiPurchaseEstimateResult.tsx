import { formatCurrency } from "@budget-app/shared";
import type { DtiPurchaseEstimateResult } from "@budget-app/shared";

const MONTHLY_LINES: Array<{ key: keyof DtiPurchaseEstimateResult["monthly"]; label: string }> = [
  { key: "principal_and_interest", label: "Principal and interest" },
  { key: "property_taxes", label: "Property taxes" },
  { key: "homeowners_insurance", label: "Homeowners insurance" },
  { key: "mortgage_insurance", label: "Mortgage insurance" },
  { key: "hoa_dues", label: "HOA dues" },
  { key: "other_required_housing_costs", label: "Other required housing costs" },
  { key: "total", label: "Total monthly housing payment" },
];

type Props = {
  estimate: DtiPurchaseEstimateResult;
};

export default function DtiPurchaseEstimateResult({ estimate }: Props) {
  const isFha = estimate.loan_estimate_type === "fha";
  const mortgageInsuranceLabel = isFha
    ? `Estimated monthly MIP${estimate.annual_mip_rate ? ` (${estimate.annual_mip_rate}%)` : ""}`
    : "Mortgage insurance";

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3" data-testid="dti-purchase-result">
      <h3 className="text-sm font-semibold text-gray-900">Estimated monthly housing payment</h3>
      <dl className="grid grid-cols-1 gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Purchase price</dt>
          <dd className="tabular-nums text-gray-900">{formatCurrency(estimate.purchase_price)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Down payment</dt>
          <dd className="tabular-nums text-gray-900" data-testid="dti-down-payment-converted">
            {formatCurrency(estimate.down_payment_amount)} ({estimate.down_payment_percent}%)
          </dd>
        </div>
        {estimate.base_loan_amount ? (
          <div className="flex justify-between gap-3">
            <dt className="text-gray-600">Base loan amount</dt>
            <dd className="tabular-nums text-gray-900">{formatCurrency(estimate.base_loan_amount)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Amount used for principal and interest</dt>
          <dd className="tabular-nums text-gray-900">{formatCurrency(estimate.loan_amount)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Submitted annual interest rate</dt>
          <dd className="tabular-nums text-gray-900" data-testid="dti-submitted-interest-rate">
            {estimate.annual_interest_rate}%
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-gray-600">Loan term</dt>
          <dd className="tabular-nums text-gray-900">{estimate.loan_term_years} years</dd>
        </div>
        {isFha ? (
          <>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600">Upfront MIP ({estimate.upfront_mip_rate}%)</dt>
              <dd className="tabular-nums text-gray-900">
                {estimate.upfront_mip_amount ? formatCurrency(estimate.upfront_mip_amount) : "Not available"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-600">Finance upfront MIP</dt>
              <dd className="text-gray-900">{estimate.finance_upfront_mip ? "Yes" : "No — paid at closing"}</dd>
            </div>
          </>
        ) : null}
      </dl>
      <dl className="grid grid-cols-1 gap-2 text-sm border-t border-gray-200 pt-2">
        {MONTHLY_LINES.map((line) => (
          <div key={line.key} className="flex justify-between gap-3">
            <dt className={line.key === "total" ? "font-medium text-gray-900" : "text-gray-600"}>
              {line.key === "mortgage_insurance" ? mortgageInsuranceLabel : line.label}
            </dt>
            <dd
              className={
                line.key === "total"
                  ? "font-medium tabular-nums text-gray-900"
                  : "tabular-nums text-gray-900"
              }
            >
              {formatCurrency(estimate.monthly[line.key])}
            </dd>
          </div>
        ))}
      </dl>
      {isFha ? (
        <p className="text-xs text-gray-500">
          Monthly MIP is a first-year estimate based on the initial base loan amount, not a declining
          amortization schedule. Upfront MIP is not added to the monthly housing payment.
          {estimate.mip_source_label ? ` Source: ${estimate.mip_source_label}.` : ""}
        </p>
      ) : (
        <p className="text-xs text-gray-500">
          This is a planning estimate for a fixed-rate loan. It does not include closing costs, prepaid
          costs, rate changes, or lender-specific fees unless you enter them as required monthly housing
          costs.
        </p>
      )}
    </div>
  );
}
