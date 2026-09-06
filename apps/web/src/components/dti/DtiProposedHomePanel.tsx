import { useState } from "react";
import { formatCurrency } from "@budget-app/shared";
import type { DtiProposedHousingInput, DtiProposedPurchaseInput, DtiPurchaseEstimateResult } from "@budget-app/shared";
import {
  normalizeProposedHousingDraft,
  type ProposedHousingDraft,
} from "../../lib/dtiForm";
import {
  EXTREME_MONTHLY_WARNING,
  MONTHLY_PAYMENT_MODE_HELP,
  MONTHLY_PAYMENT_MODE_NAME,
  PURCHASE_MODE_HELP,
  PURCHASE_MODE_NAME,
  collapsedPurchaseAssumptionLines,
  isImplausibleMonthlyHousing,
  normalizePurchaseEstimateDraft,
  type AppliedProposedHome,
  type PurchaseEstimateDraft,
  type PurchaseEstimateDraftErrors,
} from "../../lib/dtiProposedHome";
import DtiMonthlyPaymentForm from "./DtiMonthlyPaymentForm";
import DtiPurchaseEstimateForm from "./DtiPurchaseEstimateForm";
import PurchaseEstimateResult from "./DtiPurchaseEstimateResult";

type Props = {
  monthlyDraft: ProposedHousingDraft;
  purchaseDraft: PurchaseEstimateDraft;
  selectedMode: "monthly_payment" | "purchase";
  applied: AppliedProposedHome | null;
  proposedBusy: boolean;
  proposedError: boolean;
  proposedHousingTotal?: string | null;
  purchaseEstimate: DtiPurchaseEstimateResult | null;
  purchaseAssumptionsStale?: boolean;
  grossMonthlyIncome?: string | null;
  enteredMonthlyTotal: string;
  onMonthlyDraftChange: (draft: ProposedHousingDraft) => void;
  onPurchaseDraftChange: (draft: PurchaseEstimateDraft) => void;
  onSelectMode: (mode: "monthly_payment" | "purchase") => void;
  onApplyMonthly: (payload: DtiProposedHousingInput) => void;
  onApplyPurchase: (payload: DtiProposedPurchaseInput) => void;
  onClearMonthly: () => void;
  onClearPurchase: () => void;
  onRetryProposed: () => void;
};

export default function DtiProposedHomePanel({
  monthlyDraft,
  purchaseDraft,
  selectedMode,
  applied,
  proposedBusy,
  proposedError,
  proposedHousingTotal,
  purchaseEstimate,
  purchaseAssumptionsStale = false,
  grossMonthlyIncome,
  enteredMonthlyTotal,
  onMonthlyDraftChange,
  onPurchaseDraftChange,
  onSelectMode,
  onApplyMonthly,
  onApplyPurchase,
  onClearMonthly,
  onClearPurchase,
  onRetryProposed,
}: Props) {
  const [monthlyErrors, setMonthlyErrors] = useState<Partial<ProposedHousingDraft>>({});
  const [purchaseErrors, setPurchaseErrors] = useState<PurchaseEstimateDraftErrors>({});
  const [extremeOpen, setExtremeOpen] = useState(false);
  const [pendingMonthly, setPendingMonthly] = useState<DtiProposedHousingInput | null>(null);
  const [purchaseFormOpen, setPurchaseFormOpen] = useState(applied?.mode !== "purchase");
  const showPurchaseForm =
    selectedMode !== "purchase" ? false : purchaseFormOpen || proposedError;

  function applyMonthly(payload: DtiProposedHousingInput, confirmed: boolean) {
    if (!confirmed && isImplausibleMonthlyHousing(payload, grossMonthlyIncome)) {
      setPendingMonthly(payload);
      setExtremeOpen(true);
      return;
    }
    setExtremeOpen(false);
    setPendingMonthly(null);
    onApplyMonthly(payload);
  }

  function handleCalculateMonthly() {
    const result = normalizeProposedHousingDraft(monthlyDraft);
    if (!result.ok) {
      setMonthlyErrors(result.errors);
      return;
    }
    setMonthlyErrors({});
    applyMonthly(result.payload, false);
  }

  function handleCalculatePurchase() {
    const result = normalizePurchaseEstimateDraft(purchaseDraft);
    if (!result.ok) {
      setPurchaseErrors(result.errors);
      setPurchaseFormOpen(true);
      return;
    }
    setPurchaseErrors({});
    setPurchaseFormOpen(false);
    onApplyPurchase(result.payload);
  }

  const collapsedLines = collapsedPurchaseAssumptionLines(purchaseEstimate, purchaseDraft);
  const showPurchaseResult =
    selectedMode === "purchase" &&
    purchaseEstimate &&
    applied?.mode === "purchase" &&
    !proposedBusy &&
    !purchaseAssumptionsStale;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3 min-w-0">
      <h2 className="text-base font-semibold text-gray-900">Test a Proposed Home</h2>
      <p className="text-sm text-gray-600">
        Choose how you want to estimate the proposed monthly housing payment. The result replaces your
        current housing payment for this comparison.
      </p>
      <div
        role="radiogroup"
        aria-label="How to estimate the proposed monthly housing payment"
        className="grid grid-cols-1 gap-2"
      >
        {(
          [
            {
              mode: "monthly_payment" as const,
              name: MONTHLY_PAYMENT_MODE_NAME,
              help: MONTHLY_PAYMENT_MODE_HELP,
            },
            {
              mode: "purchase" as const,
              name: PURCHASE_MODE_NAME,
              help: PURCHASE_MODE_HELP,
            },
          ]
        ).map((option) => {
          const selected = selectedMode === option.mode;
          return (
            <label
              key={option.mode}
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                selected ? "border-blue-700 bg-blue-50" : "border-gray-300 bg-white"
              }`}
            >
              <input
                type="radio"
                name="dti-proposed-home-mode"
                value={option.mode}
                className="mt-1"
                checked={selected}
                aria-label={option.name}
                aria-describedby={`dti-mode-${option.mode}-help`}
                onChange={() => onSelectMode(option.mode)}
              />
              <span>
                <span className="block font-medium text-gray-900">
                  {option.name}
                  {selected ? (
                    <span className="ml-2 text-xs font-semibold text-blue-800">Selected</span>
                  ) : null}
                </span>
                <span id={`dti-mode-${option.mode}-help`} className="block text-xs text-gray-600 mt-0.5">
                  {option.help}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {selectedMode === "monthly_payment" ? (
        <>
          <DtiMonthlyPaymentForm
            draft={monthlyDraft}
            errors={monthlyErrors}
            disabled={proposedBusy}
            onChange={onMonthlyDraftChange}
          />
          <p className="text-sm text-gray-700">Entered total: {formatCurrency(enteredMonthlyTotal)}</p>
          {extremeOpen ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2" role="status">
              <p className="text-sm text-amber-950">{EXTREME_MONTHLY_WARNING}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md bg-amber-800 px-3 py-2 text-sm text-white min-h-[44px]"
                  onClick={() => pendingMonthly && applyMonthly(pendingMonthly, true)}
                >
                  Continue with this monthly payment
                </button>
                <button
                  type="button"
                  className="rounded-md border border-amber-400 px-3 py-2 text-sm text-amber-950 min-h-[44px]"
                  onClick={() => {
                    setExtremeOpen(false);
                    setPendingMonthly(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {!showPurchaseForm ? (
            <div
              className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2"
              data-testid="dti-purchase-collapsed"
            >
              <ul className="text-sm text-gray-800 space-y-0.5">
                {collapsedLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <button
                type="button"
                className="text-sm font-medium text-blue-700 hover:underline min-h-[44px]"
                onClick={() => setPurchaseFormOpen(true)}
              >
                Edit purchase assumptions
              </button>
            </div>
          ) : (
            <DtiPurchaseEstimateForm
              draft={purchaseDraft}
              errors={purchaseErrors}
              disabled={proposedBusy}
              onChange={onPurchaseDraftChange}
            />
          )}
        </>
      )}

      {proposedBusy ? (
        <p className="text-sm text-gray-600" aria-live="polite">
          Updating proposed home calculation…
        </p>
      ) : null}
      {applied && proposedError && !proposedBusy ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-red-600">Could not calculate the proposed home payment.</p>
          <button
            type="button"
            onClick={onRetryProposed}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
          >
            Retry
          </button>
        </div>
      ) : null}
      {selectedMode === "monthly_payment" && proposedHousingTotal && applied?.mode === "monthly_payment" && !proposedBusy ? (
        <p className="text-sm font-medium text-gray-900">
          Estimated total monthly housing payment: {formatCurrency(proposedHousingTotal)}
        </p>
      ) : null}
      {showPurchaseResult && purchaseEstimate ? (
        <PurchaseEstimateResult estimate={purchaseEstimate} />
      ) : null}
      {selectedMode === "purchase" && purchaseAssumptionsStale && applied?.mode === "purchase" ? (
        <p className="text-sm text-amber-900" data-testid="dti-purchase-stale">
          Purchase assumptions have changed. Estimate Purchase DTI to update the result.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {selectedMode === "monthly_payment" ? (
          <>
            <button
              type="button"
              onClick={handleCalculateMonthly}
              disabled={proposedBusy}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px] disabled:opacity-50"
            >
              {proposedBusy ? "Calculating…" : "Calculate Monthly DTI"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMonthlyErrors({});
                setExtremeOpen(false);
                setPendingMonthly(null);
                onClearMonthly();
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 min-h-[44px]"
            >
              Clear Monthly Estimate
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCalculatePurchase}
              disabled={proposedBusy}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px] disabled:opacity-50"
            >
              {proposedBusy ? "Calculating…" : "Estimate Purchase DTI"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPurchaseErrors({});
                setPurchaseFormOpen(true);
                onClearPurchase();
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 min-h-[44px]"
            >
              Clear Purchase Estimate
            </button>
          </>
        )}
      </div>
    </section>
  );
}
