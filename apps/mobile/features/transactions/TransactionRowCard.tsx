import React, { memo } from "react";
import { Text, View } from "react-native";
import { formatCurrency } from "@budget-app/shared";
import type { Transaction, TimelineRow } from "@budget-app/shared";
import { CurrencyDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";
import { isTransferTransaction } from "@/lib/transactionStatus";
import { timelineTransferSubtitle, transactionTransferSubtitle } from "./transferDisplay";

type Props = {
  txn?: Transaction;
  timelineRow?: TimelineRow;
  runningBalance?: string | null;
  statusOverride?: "Forecast" | "Pending" | "Reconciled" | null;
};

function secondaryCategoryLabel(
  txn?: Transaction,
  timelineRow?: TimelineRow,
  isTransfer?: boolean
): string {
  if (isTransfer) {
    if (txn) {
      const label = transactionTransferSubtitle(txn);
      if (label) return "Transfer";
    }
    return "Transfer";
  }
  return txn?.category?.name ?? timelineRow?.category_name ?? "—";
}

export const TransactionRowCard = memo(function TransactionRowCard({
  txn,
  timelineRow,
  runningBalance,
  statusOverride = null,
}: Props) {
  const theme = useTheme();
  const payee = txn?.payee ?? timelineRow?.description ?? "—";
  const date = txn?.date ?? timelineRow?.date ?? "";
  const amount = txn?.amount ?? timelineRow?.amount ?? "0";
  const direction = txn?.direction ?? (parseFloat(amount) >= 0 ? "INFLOW" : "OUTFLOW");
  const isTransfer = txn
    ? isTransferTransaction(txn)
    : Boolean(timelineRow?.type?.toLowerCase().includes("transfer"));
  const categoryLine = secondaryCategoryLabel(txn, timelineRow, isTransfer);
  const transferSubtitle = txn
    ? transactionTransferSubtitle(txn)
    : timelineRow
      ? timelineTransferSubtitle(timelineRow)
      : null;

  let status = statusOverride;
  if (status == null) {
    // Do NOT map cleared=false to "Pending" — that word is reserved for the
    // Pending Expected section (scheduled/due, not yet confirmed). Uncleared
    // posted activity stays in Recent without a redundant status line.
    if (txn?.reconciled || timelineRow?.reconciled) status = "Reconciled";
  }

  return (
    <View
      style={{
        paddingVertical: theme.spacing.sm + 2,
        paddingHorizontal: theme.spacing.lg,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor:
          statusOverride === "Pending" ? theme.colors.surfaceMuted : "transparent",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Text
          style={{ color: theme.colors.text, ...theme.typography.bodyStrong, flex: 1 }}
          numberOfLines={1}
        >
          {payee}
        </Text>
        <CurrencyDisplay
          amount={amount}
          tone={direction === "INFLOW" ? "positive" : "negative"}
          style={{ fontSize: 16, flexShrink: 0 }}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 2,
        }}
      >
        <Text
          style={{ color: theme.colors.textMuted, ...theme.typography.caption, flex: 1 }}
          numberOfLines={1}
        >
          {formatDateDisplay(date)} · {categoryLine}
        </Text>
        {runningBalance != null ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, flexShrink: 0 }}>
            Bal {formatCurrency(runningBalance)}
          </Text>
        ) : null}
      </View>

      {transferSubtitle && isTransfer ? (
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
          {transferSubtitle}
        </Text>
      ) : null}

      {status ? (
        <Text
          style={{
            color: status === "Pending" ? theme.colors.warning : theme.colors.textMuted,
            ...theme.typography.caption,
            marginTop: 2,
            fontSize: 11,
          }}
        >
          {status}
        </Text>
      ) : null}
    </View>
  );
});
