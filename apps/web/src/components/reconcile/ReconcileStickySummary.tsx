import { formatCurrency } from "@budget-app/shared";
import { centsToAmount } from "../../lib/moneyCents";
import { formatSignedCurrency, selectedCountLabel } from "../../lib/reconcileWorkflow";
import { completeDisabledReason, isReconcileBalanced } from "../../lib/reconcileWorkflow";

type Props = {
  isFirstReconciliation: boolean;
  periodStartLabel: string;
  periodEndLabel: string;
  openingCents: number;
  selectedActivityCents: number;
  calculatedCents: number;
  bankCents: number | null;
  selectedCount: number;
  totalCount: number;
  leftoverHint: boolean;
  completeError: string | null;
  completeSuccess: boolean;
  periodLabel: string;
  isPending: boolean;
  onComplete: () => void;
};

export default function ReconcileStickySummary({
  isFirstReconciliation,
  periodStartLabel,
  periodEndLabel,
  openingCents,
  selectedActivityCents,
  calculatedCents,
  bankCents,
  selectedCount,
  totalCount,
  leftoverHint,
  completeError,
  completeSuccess,
  periodLabel,
  isPending,
  onComplete,
}: Props) {
  const differenceCents = bankCents != null ? bankCents - calculatedCents : null;
  const balanced = isReconcileBalanced(differenceCents);
  const disabledReason = completeDisabledReason({
    hasBankBalance: bankCents != null,
    differenceCents,
  });
  const canComplete = disabledReason == null && !isPending;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
      <div className="w-full px-4 sm:px-6 lg:px-8 py-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2 text-sm mb-3">
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">
              {isFirstReconciliation ? "Opening balance" : "Period opening balance"}
              {periodStartLabel ? ` (${periodStartLabel})` : ""}
            </span>
            <span className="font-medium tabular-nums">{formatCurrency(centsToAmount(openingCents))}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Selected activity</span>
            <span className="font-medium tabular-nums">{formatSignedCurrency(selectedActivityCents)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Calculated ending balance</span>
            <span className="font-semibold tabular-nums">{formatCurrency(centsToAmount(calculatedCents))}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">
              Bank statement balance{periodEndLabel ? ` (${periodEndLabel})` : ""}
            </span>
            <span className="font-medium tabular-nums">
              {bankCents != null ? formatCurrency(centsToAmount(bankCents)) : "—"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Difference</span>
            <span
              className={`font-semibold tabular-nums ${
                differenceCents == null ? "text-gray-400" : balanced ? "text-green-700" : "text-amber-800"
              }`}
            >
              {differenceCents == null ? "—" : formatCurrency(centsToAmount(differenceCents))}
              {differenceCents != null && balanced ? " ✓" : ""}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">Selection</span>
            <span className="font-medium tabular-nums">{selectedCountLabel(selectedCount, totalCount)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {completeError && <p className="text-sm text-red-600">{completeError}</p>}
            {completeSuccess && (
              <p className="text-sm text-green-700">Reconciliation saved for {periodLabel}.</p>
            )}
            {!completeError && !completeSuccess && disabledReason && (
              <p id="complete-disabled-reason" className="text-xs text-gray-500">
                {disabledReason}
              </p>
            )}
            {!completeError && leftoverHint && balanced && (
              <p className="text-xs text-gray-500">
                Unchecked transactions will be reviewed after you complete.
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={!canComplete}
            aria-describedby={!canComplete && disabledReason ? "complete-disabled-reason" : undefined}
            onClick={onComplete}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? "Saving…" : "Complete Reconciliation"}
          </button>
        </div>
      </div>
    </div>
  );
}
