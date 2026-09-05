import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewTransferBalances, type TransferBalancePreviewResponse } from "@budget-app/api-client";
import { transferPreviewAmountPayload, transferPreviewAmountReady } from "../lib/transferPreviewAccounts";

const DEFAULT_DEBOUNCE_MS = 400;

function useDebouncedPreviewValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function useTransferBalancePreview(input: {
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: string;
  date: string;
  excludeTransactionIds?: number[];
  enabled?: boolean;
  /** Debounce preview API inputs only — not the saved form value. */
  debounceMs?: number;
}): {
  data: TransferBalancePreviewResponse | undefined;
  isFetching: boolean;
} {
  const debounceMs = input.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const debouncedAmount = useDebouncedPreviewValue(input.amount, debounceMs);
  const debouncedDate = useDebouncedPreviewValue(input.date, debounceMs);

  const amountReady = useMemo(
    () => transferPreviewAmountReady(debouncedAmount),
    [debouncedAmount]
  );
  const amountPayload = useMemo(
    () => transferPreviewAmountPayload(debouncedAmount),
    [debouncedAmount]
  );

  const excludeKey = (input.excludeTransactionIds ?? []).slice().sort((a, b) => a - b).join(",");

  const enabled =
    (input.enabled ?? true) &&
    input.fromAccountId != null &&
    input.toAccountId != null &&
    Boolean(debouncedDate) &&
    amountReady;

  const query = useQuery({
    queryKey: [
      "transactions",
      "transfer-preview",
      input.fromAccountId,
      input.toAccountId,
      debouncedDate,
      amountPayload,
      excludeKey,
    ],
    queryFn: () =>
      previewTransferBalances({
        from_account_id: input.fromAccountId!,
        to_account_id: input.toAccountId!,
        amount: amountPayload,
        date: debouncedDate,
        exclude_transaction_ids: input.excludeTransactionIds,
      }),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return { data: query.data, isFetching: query.isFetching };
}
