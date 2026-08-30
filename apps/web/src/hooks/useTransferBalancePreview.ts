import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewTransferBalances, type TransferBalancePreviewResponse } from "@budget-app/api-client";

export function useTransferBalancePreview(input: {
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: string;
  date: string;
  excludeTransactionIds?: number[];
  enabled?: boolean;
}): {
  data: TransferBalancePreviewResponse | undefined;
  isFetching: boolean;
} {
  const amountReady = useMemo(() => {
    const raw = parseFloat(String(input.amount).trim());
    return Number.isFinite(raw) && raw !== 0;
  }, [input.amount]);

  const excludeKey = (input.excludeTransactionIds ?? []).slice().sort((a, b) => a - b).join(",");

  const enabled =
    (input.enabled ?? true) &&
    input.fromAccountId != null &&
    input.toAccountId != null &&
    Boolean(input.date) &&
    amountReady;

  const query = useQuery({
    queryKey: [
      "transactions",
      "transfer-preview",
      input.fromAccountId,
      input.toAccountId,
      input.date,
      input.amount.trim(),
      excludeKey,
    ],
    queryFn: () =>
      previewTransferBalances({
        from_account_id: input.fromAccountId!,
        to_account_id: input.toAccountId!,
        amount: input.amount.trim(),
        date: input.date,
        exclude_transaction_ids: input.excludeTransactionIds,
      }),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return { data: query.data, isFetching: query.isFetching };
}
