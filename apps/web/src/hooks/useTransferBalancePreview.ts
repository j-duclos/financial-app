import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewTransferBalances, type TransferBalancePreviewResponse } from "@budget-app/api-client";
import { transferPreviewAmountPayload, transferPreviewAmountReady } from "../lib/transferPreviewAccounts";

const DEFAULT_DEBOUNCE_MS = 400;

function previewKey(input: {
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: string;
  date: string;
  excludeKey: string;
}): string {
  return [
    input.fromAccountId ?? "",
    input.toAccountId ?? "",
    input.date,
    transferPreviewAmountPayload(input.amount),
    input.excludeKey,
  ].join("|");
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
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
  /** Debounce preview API requests only — displayed results clear immediately. */
  debounceMs?: number;
}): {
  data: TransferBalancePreviewResponse | undefined;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  queryMatchesLiveInputs: boolean;
  refetch: () => void;
} {
  const debounceMs = input.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const excludeKey = (input.excludeTransactionIds ?? []).slice().sort((a, b) => a - b).join(",");
  const liveKey = previewKey({
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amount: input.amount,
    date: input.date,
    excludeKey,
  });
  const debouncedKey = useDebouncedValue(liveKey, debounceMs);
  const queryMatchesLiveInputs = liveKey === debouncedKey;

  const amountReady = useMemo(
    () => transferPreviewAmountReady(input.amount),
    [input.amount]
  );
  const amountPayload = useMemo(
    () => transferPreviewAmountPayload(input.amount),
    [input.amount]
  );

  const fieldsReady =
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
      amountPayload,
      excludeKey,
    ],
    queryFn: () =>
      previewTransferBalances({
        from_account_id: input.fromAccountId!,
        to_account_id: input.toAccountId!,
        amount: amountPayload,
        date: input.date,
        exclude_transaction_ids: input.excludeTransactionIds,
      }),
    enabled: fieldsReady && queryMatchesLiveInputs,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    placeholderData: undefined,
    retry: 1,
  });

  const errorMessage =
    query.error instanceof Error ? query.error.message : query.isError ? "Could not calculate projected balance." : null;

  return {
    data: queryMatchesLiveInputs ? query.data : undefined,
    isFetching: Boolean(fieldsReady && (!queryMatchesLiveInputs || query.isFetching || query.isPending)),
    isError: queryMatchesLiveInputs && query.isError,
    errorMessage: queryMatchesLiveInputs ? errorMessage : null,
    queryMatchesLiveInputs,
    refetch: () => {
      void query.refetch();
    },
  };
}
