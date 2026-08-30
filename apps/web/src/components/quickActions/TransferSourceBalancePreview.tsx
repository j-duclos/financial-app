import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { previewTransferBalances } from "@budget-app/api-client";
import { formatDateDisplay } from "../../lib/dateDisplay";

type Props = {
  sourceAccount: Account;
  destinationAccountId?: number | null;
  transferDate: string;
  transferAmount: string;
  excludeTransactionIds?: number[];
};

/** Backend-owned transfer balance preview — no client balance +/- amount arithmetic. */
export default function TransferSourceBalancePreview({
  sourceAccount,
  destinationAccountId = null,
  transferDate,
  transferAmount,
  excludeTransactionIds = [],
}: Props) {
  const amountReady = useMemo(() => {
    const raw = parseFloat(String(transferAmount).trim());
    return Number.isFinite(raw) && raw !== 0;
  }, [transferAmount]);

  const { data, isFetching } = useQuery({
    queryKey: [
      "transactions",
      "transfer-preview",
      sourceAccount.id,
      destinationAccountId,
      transferDate,
      transferAmount.trim(),
      excludeTransactionIds.slice().sort((a, b) => a - b).join(","),
    ],
    queryFn: () =>
      previewTransferBalances({
        from_account_id: sourceAccount.id,
        to_account_id: destinationAccountId ?? undefined,
        amount: transferAmount.trim(),
        date: transferDate,
        exclude_transaction_ids: excludeTransactionIds,
      }),
    enabled: transferDate !== "" && amountReady,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const sourceBefore = data?.source_balance_before;
  const sourceAfter = data?.source_balance_after;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs font-medium text-gray-700">
        {sourceAccount.name} — balance on {formatDateDisplay(transferDate)} (canonical preview)
      </div>
      {isFetching && !data ? (
        <p className="text-xs text-gray-500 mt-1">Loading…</p>
      ) : (
        <>
          <div className="mt-2 space-y-1">
            <div className="text-[11px] text-gray-600">Current (this transfer excluded)</div>
            <p className="text-sm font-medium text-slate-900 tabular-nums">
              {sourceBefore != null
                ? formatCurrency(sourceBefore, sourceAccount.currency)
                : "—"}
            </p>
          </div>
          <div className="mt-2 space-y-1 pt-2 border-t border-slate-200/80">
            <div className="text-[11px] text-gray-600">Projected after this transfer</div>
            <p
              className={`text-base font-semibold tabular-nums ${
                sourceAfter != null && sourceBefore != null
                  ? parseFloat(sourceAfter) >= parseFloat(sourceBefore)
                    ? "text-emerald-800"
                    : "text-amber-900"
                  : "text-slate-900"
              }`}
            >
              {sourceAfter != null
                ? formatCurrency(sourceAfter, sourceAccount.currency)
                : "—"}
            </p>
          </div>
        </>
      )}
      <p className="text-[11px] text-gray-500 mt-2">
        Scheduled activity on or before this date is included. Values come from the server preview
        endpoint — not client-side balance arithmetic.
      </p>
    </div>
  );
}
