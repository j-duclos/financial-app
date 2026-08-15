import { formatCurrency } from "@budget-app/shared";
import { centsToAmount } from "../../lib/moneyCents";
import { RECONCILE_BALANCE_TOLERANCE_CENTS } from "../../lib/reconcileWorkflow";

type Props = {
  bankCents: number | null;
  calculatedCents: number;
};

export default function ReconcileLiveEquation({ bankCents, calculatedCents }: Props) {
  const hasBank = bankCents != null;
  const diffCents = hasBank ? bankCents - calculatedCents : null;
  const balanced =
    diffCents != null && Math.abs(diffCents) <= RECONCILE_BALANCE_TOLERANCE_CENTS;

  return (
    <div className="grid sm:grid-cols-3 gap-4 mt-2">
      <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
        <p className="text-xs font-medium text-gray-500 mb-1">Bank statement balance</p>
        <p className="text-lg font-semibold tabular-nums">
          {hasBank ? formatCurrency(centsToAmount(bankCents)) : "—"}
        </p>
      </div>
      <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
        <p className="text-xs font-medium text-gray-500 mb-1">Calculated app balance</p>
        <p className="text-lg font-semibold tabular-nums">{formatCurrency(centsToAmount(calculatedCents))}</p>
      </div>
      <div
        className={`rounded-lg border px-4 py-3 ${
          !hasBank
            ? "bg-gray-50 border-gray-100"
            : balanced
              ? "bg-green-50 border-green-100"
              : "bg-amber-50 border-amber-100"
        }`}
      >
        <p className="text-xs font-medium text-gray-500 mb-1">Difference</p>
        <p
          className={`text-lg font-semibold tabular-nums ${
            !hasBank ? "text-gray-400" : balanced ? "text-green-700" : "text-amber-800"
          }`}
        >
          {diffCents == null ? "—" : formatCurrency(centsToAmount(diffCents))}
        </p>
        <p
          className={`text-xs font-medium mt-1 ${
            !hasBank ? "text-gray-400" : balanced ? "text-green-700" : "text-amber-800"
          }`}
        >
          {!hasBank ? "Enter bank balance" : balanced ? "✓ Balanced" : "Not balanced"}
        </p>
      </div>
    </div>
  );
}
