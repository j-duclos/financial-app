import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { getTimeline } from "@budget-app/api-client";
import { formatDateDisplay } from "../../lib/dateDisplay";
import {
  assetBalanceAsOfDateFromTimeline,
  projectionTimelineRangeForAsOf,
} from "../transactions/transactionsLedgerUtils";

type Props = {
  sourceAccount: Account;
  transferDate: string;
  transferAmount: string;
};

export default function TransferSourceBalancePreview({
  sourceAccount,
  transferDate,
  transferAmount,
}: Props) {
  const projectionRange = useMemo(
    () => (transferDate ? projectionTimelineRangeForAsOf(transferDate) : null),
    [transferDate]
  );

  const { data: timelineData, isFetching } = useQuery({
    queryKey: [
      "timeline",
      "quick-transfer-source",
      sourceAccount.id,
      projectionRange?.start,
      projectionRange?.end,
      projectionRange?.as_of,
    ],
    queryFn: () =>
      getTimeline({
        start: projectionRange!.start,
        end: projectionRange!.end,
        as_of: projectionRange!.as_of,
        account_id: sourceAccount.id,
      }),
    enabled:
      projectionRange != null && transferDate !== "" && Number.isFinite(sourceAccount.id),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  const balanceBefore = useMemo(() => {
    if (!timelineData?.timeline || !transferDate) return null;
    return assetBalanceAsOfDateFromTimeline(
      timelineData.timeline,
      sourceAccount.id,
      transferDate,
      new Set()
    );
  }, [timelineData?.timeline, sourceAccount.id, transferDate]);

  const balanceAfter = useMemo(() => {
    if (balanceBefore == null) return null;
    const raw = parseFloat(String(transferAmount).trim());
    if (Number.isNaN(raw) || raw === 0) return null;
    return balanceBefore - Math.abs(raw);
  }, [balanceBefore, transferAmount]);

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs font-medium text-gray-700">
        {sourceAccount.name} — balance on {formatDateDisplay(transferDate)} (from your timeline)
      </div>
      {isFetching ? (
        <p className="text-xs text-gray-500 mt-1">Loading…</p>
      ) : (
        <>
          <div className="mt-2 space-y-1">
            <div className="text-[11px] text-gray-600">Current (this transfer excluded)</div>
            <p className="text-sm font-medium text-slate-900 tabular-nums">
              {balanceBefore != null
                ? formatCurrency(String(balanceBefore), sourceAccount.currency)
                : "—"}
            </p>
          </div>
          <div className="mt-2 space-y-1 pt-2 border-t border-slate-200/80">
            <div className="text-[11px] text-gray-600">Projected after this transfer</div>
            <p
              className={`text-base font-semibold tabular-nums ${
                balanceAfter != null && balanceBefore != null
                  ? balanceAfter >= balanceBefore
                    ? "text-emerald-800"
                    : "text-amber-900"
                  : "text-slate-900"
              }`}
            >
              {balanceAfter != null
                ? formatCurrency(String(balanceAfter), sourceAccount.currency)
                : "—"}
            </p>
          </div>
        </>
      )}
      <p className="text-[11px] text-gray-500 mt-2">
        Scheduled activity on or before this date is included. The first line is this account&apos;s
        balance without this transfer. The second applies the outflow from the source account above.
      </p>
    </div>
  );
}
