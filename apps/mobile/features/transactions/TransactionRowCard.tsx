import React from "react";
import { Text, View } from "react-native";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import type { Transaction, TimelineRow } from "@budget-app/shared";
import { CurrencyDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";
import {
  resolveTransactionStatusIcons,
  STATUS_ICON_LABELS,
  type TransactionStatusIcon,
} from "@/lib/transactionStatus";
import { isTransferTransaction } from "@/lib/transactionStatus";

type Props = {
  txn?: Transaction;
  timelineRow?: TimelineRow;
  runningBalance?: string | null;
  showAccount?: boolean;
  onPress?: () => void;
};

function StatusBadge({ icon }: { icon: TransactionStatusIcon }) {
  const theme = useTheme();
  const colors: Record<TransactionStatusIcon, string> = {
    reconciled: theme.colors.textMuted,
    manual: theme.colors.textSecondary,
    rule: theme.colors.tint,
    plaid: theme.colors.warning,
    transfer: theme.colors.textSecondary,
    forecast: theme.colors.tint,
  };
  const icons: Record<TransactionStatusIcon, React.ComponentProps<typeof FontAwesome>["name"]> = {
    reconciled: "check-circle",
    manual: "pencil",
    rule: "repeat",
    plaid: "bank",
    transfer: "exchange",
    forecast: "clock-o",
  };
  return (
    <View
      accessibilityLabel={STATUS_ICON_LABELS[icon]}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: theme.radius.sm,
        backgroundColor: theme.colors.surfaceMuted,
      }}
    >
      <FontAwesome name={icons[icon]} size={10} color={colors[icon]} />
      <Text style={{ color: colors[icon], ...theme.typography.caption, fontSize: 10 }}>
        {STATUS_ICON_LABELS[icon]}
      </Text>
    </View>
  );
}

export function TransactionRowCard({ txn, timelineRow, runningBalance, showAccount = true }: Props) {
  const theme = useTheme();
  const payee = txn?.payee ?? timelineRow?.description ?? "—";
  const date = txn?.date ?? timelineRow?.date ?? "";
  const amount = txn?.amount ?? timelineRow?.amount ?? "0";
  const direction = txn?.direction ?? (parseFloat(amount) >= 0 ? "INFLOW" : "OUTFLOW");
  const isTransfer = txn ? isTransferTransaction(txn) : timelineRow?.type?.toLowerCase().includes("transfer");
  const categoryName = txn?.category?.name ?? timelineRow?.category_name ?? null;
  const accountName =
    txn?.account ? getEffectiveDisplayName(txn.account) : timelineRow?.account_name ?? null;
  const statusIcons = txn
    ? resolveTransactionStatusIcons(txn, timelineRow)
    : (["forecast"] as TransactionStatusIcon[]);
  const cleared = txn?.cleared;
  const reconciled = txn?.reconciled ?? timelineRow?.reconciled;

  return (
    <View
      style={{
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: reconciled && !txn ? 0.85 : 1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isTransfer
              ? theme.colors.surfaceMuted
              : direction === "INFLOW"
                ? theme.colors.moneyPositiveBg
                : theme.colors.surfaceMuted,
          }}
        >
          <FontAwesome
            name={isTransfer ? "exchange" : direction === "INFLOW" ? "arrow-down" : "arrow-up"}
            size={14}
            color={
              isTransfer
                ? theme.colors.textSecondary
                : direction === "INFLOW"
                  ? theme.colors.moneyPositive
                  : theme.colors.textSecondary
            }
          />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong }} numberOfLines={1}>
            {payee}
          </Text>
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
            {formatDateDisplay(date)}
            {showAccount && accountName ? ` · ${accountName}` : ""}
            {categoryName ? ` · ${categoryName}` : ""}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
            {statusIcons.slice(0, 3).map((icon) => (
              <StatusBadge key={icon} icon={icon} />
            ))}
            {cleared === false ? (
              <Text style={{ color: theme.colors.warning, ...theme.typography.caption, fontSize: 10 }}>
                Pending
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <CurrencyDisplay
            amount={amount}
            tone={isTransfer ? "neutral" : direction === "INFLOW" ? "positive" : "negative"}
            style={{ fontSize: 16 }}
          />
          {runningBalance != null ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
              Bal {formatCurrency(runningBalance)}
            </Text>
          ) : reconciled ? (
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Bal —</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
