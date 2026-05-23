import { formatCurrency } from "@budget-app/shared";

type Props = {
  currentBalance: number;
  safeToSpend: number | null;
  minimumBuffer: number | null;
  currency: string;
  isCredit: boolean;
};

/** Visual bar showing balance relative to minimum buffer and safe-to-spend. */
export default function BalanceBufferBar({
  currentBalance,
  safeToSpend,
  minimumBuffer,
  currency,
  isCredit,
}: Props) {
  if (isCredit || minimumBuffer == null) return null;

  const buffer = parseFloat(String(minimumBuffer));
  if (Number.isNaN(buffer) || buffer <= 0) return null;

  const balance = currentBalance;
  const sts = safeToSpend ?? balance - buffer;
  const maxVal = Math.max(balance, buffer, sts, buffer * 2, 1);
  const balancePct = Math.min(100, Math.max(0, (balance / maxVal) * 100));
  const bufferPct = Math.min(100, Math.max(0, (buffer / maxVal) * 100));
  const stsPct = Math.min(100, Math.max(0, (Math.max(0, sts) / maxVal) * 100));

  const belowBuffer = balance < buffer;

  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex justify-between text-[10px] text-gray-500 uppercase tracking-wide">
        <span>Buffer zone</span>
        <span>
          Buffer {formatCurrency(buffer, currency)}
          {safeToSpend != null && (
            <> · STS {formatCurrency(safeToSpend, currency)}</>
          )}
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-gray-100 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-slate-300/60"
          style={{ width: `${bufferPct}%` }}
          title={`Minimum buffer: ${formatCurrency(buffer, currency)}`}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all ${
            belowBuffer ? "bg-red-500" : sts < 0 ? "bg-amber-500" : "bg-emerald-500"
          }`}
          style={{ width: `${balancePct}%` }}
          title={`Current: ${formatCurrency(balance, currency)}`}
        />
        {safeToSpend != null && sts >= 0 && (
          <div
            className="absolute inset-y-0 border-r-2 border-emerald-700/50"
            style={{ left: `${stsPct}%` }}
            title={`Safe to spend: ${formatCurrency(sts, currency)}`}
          />
        )}
      </div>
      {belowBuffer && (
        <p className="text-xs text-red-700">Balance is below your minimum buffer.</p>
      )}
    </div>
  );
}
