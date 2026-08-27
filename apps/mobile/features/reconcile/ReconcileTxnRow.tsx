import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import type { ReconcileTransactionRow } from "@budget-app/shared";
import { CurrencyDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatDateDisplay } from "@/lib/dates";

type Props = {
  transaction: ReconcileTransactionRow;
  checked: boolean;
  onToggle: () => void;
  onOpenDetail: () => void;
};

export function ReconcileTxnRow({ transaction, checked, onToggle, onOpenDetail }: Props) {
  const theme = useTheme();
  const amount = parseFloat(transaction.amount);
  const subtitleParts = [
    formatDateDisplay(transaction.date),
    transaction.category || transaction.memo || null,
  ].filter(Boolean);
  const accessibilityAmount = Number.isFinite(amount)
    ? `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`
    : transaction.amount;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        borderBottomWidth: StyleSheetHairline,
        borderBottomColor: theme.colors.border,
        backgroundColor: theme.colors.surface,
        gap: theme.spacing.sm,
        minHeight: theme.touchTarget,
      }}
    >
      <Pressable
        onPress={onOpenDetail}
        accessibilityRole="button"
        accessibilityLabel={`${transaction.payee}, ${accessibilityAmount}. Open details`}
        style={{ flex: 1, minWidth: 0, gap: 2 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text
            style={{ color: theme.colors.text, fontWeight: "600", fontSize: 16, flex: 1 }}
            numberOfLines={1}
          >
            {transaction.payee || "Transaction"}
          </Text>
          <CurrencyDisplay
            amount={Number.isFinite(amount) ? amount : 0}
            tone={amount < 0 ? "negative" : amount > 0 ? "positive" : "neutral"}
            showSign
            style={{ fontSize: 16 }}
          />
        </View>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }} numberOfLines={1}>
          {subtitleParts.join(" · ")}
        </Text>
      </Pressable>
      <Switch
        value={checked}
        onValueChange={onToggle}
        accessibilityLabel={`Mark ${transaction.payee || "transaction"} ${accessibilityAmount} as cleared`}
      />
    </View>
  );
}

const StyleSheetHairline = 1 / 2;
