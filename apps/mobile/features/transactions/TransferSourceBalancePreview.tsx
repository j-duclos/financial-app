import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { Account } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { previewTransferBalances } from "@budget-app/api-client";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { transactionQueryKeys } from "./queryKeys";

type Props = {
  sourceAccount: Account | null;
  destinationAccountId?: number | null;
  transferDateIso: string | null;
  transferAmount: string;
  /** When editing, exclude linked legs so preview replaces rather than double-counts. */
  excludeTransactionIds?: number[];
  label?: string;
};

/** Backend-owned transfer balance preview — no client balance +/- amount arithmetic. */
export function TransferSourceBalancePreview({
  sourceAccount,
  destinationAccountId = null,
  transferDateIso,
  transferAmount,
  excludeTransactionIds = [],
  label,
}: Props) {
  const theme = useTheme();
  const debouncedAmount = useDebouncedValue(transferAmount, 400);

  const amountReady = useMemo(() => {
    const raw = parseFloat(String(debouncedAmount).trim());
    return Number.isFinite(raw) && raw !== 0;
  }, [debouncedAmount]);

  const previewKey = useMemo(
    () => ({
      from_account_id: sourceAccount?.id,
      to_account_id: destinationAccountId ?? undefined,
      amount: debouncedAmount.trim(),
      date: transferDateIso,
      exclude: excludeTransactionIds.slice().sort((a, b) => a - b).join(","),
    }),
    [
      sourceAccount?.id,
      destinationAccountId,
      debouncedAmount,
      transferDateIso,
      excludeTransactionIds,
    ]
  );

  const { data, isFetching } = useQuery({
    queryKey: transactionQueryKeys.transferPreview(previewKey),
    queryFn: () =>
      previewTransferBalances({
        from_account_id: sourceAccount!.id,
        to_account_id: destinationAccountId ?? undefined,
        amount: debouncedAmount.trim(),
        date: transferDateIso!,
        exclude_transaction_ids: excludeTransactionIds,
      }),
    enabled:
      sourceAccount != null &&
      Boolean(transferDateIso) &&
      amountReady,
    staleTime: 60_000,
  });

  if (!sourceAccount || !transferDateIso) return null;

  const currency = sourceAccount.currency ?? "USD";
  const title = label ?? sourceAccount.effective_display_name ?? sourceAccount.name;
  const sourceBefore = data?.source_balance_before;
  const sourceAfter = data?.source_balance_after;

  return (
    <View
      style={{
        marginTop: theme.spacing.sm,
        padding: theme.spacing.md,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.surfaceMuted,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }}>{title}</Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
        Balance on {formatDateDisplay(transferDateIso)} (canonical preview)
      </Text>
      {isFetching && !data ? (
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
          Loading…
        </Text>
      ) : (
        <>
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
            Current (this transfer excluded)
          </Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginTop: 2 }}>
            {sourceBefore != null ? formatCurrency(sourceBefore, currency) : "—"}
          </Text>
          {sourceAfter != null ? (
            <>
              <Text
                style={{
                  color: theme.colors.textMuted,
                  ...theme.typography.caption,
                  marginTop: theme.spacing.sm,
                }}
              >
                Projected after this transfer
              </Text>
              <Text
                style={{
                  color:
                    sourceBefore != null && parseFloat(sourceAfter) < parseFloat(sourceBefore)
                      ? theme.colors.warning
                      : theme.colors.moneyPositive,
                  ...theme.typography.bodyStrong,
                  marginTop: 2,
                }}
              >
                {formatCurrency(sourceAfter, currency)}
              </Text>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}
