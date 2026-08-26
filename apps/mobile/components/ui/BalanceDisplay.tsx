import React from "react";
import { Text, View } from "react-native";
import { CurrencyDisplay } from "./CurrencyDisplay";
import { useTheme, type FinancialTone } from "@/theme";

type Props = {
  label: string;
  amount: string | number;
  subtitle?: string;
  tone?: FinancialTone;
  accessibilityHint?: string;
};

/** Compact balance/metric tile used on Dashboard and summaries. */
export function BalanceDisplay({ label, amount, subtitle, tone, accessibilityHint }: Props) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${label}: ${amount}${subtitle ? `. ${subtitle}` : ""}`}
      accessibilityHint={accessibilityHint}
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.lg,
        flex: 1,
        minWidth: "46%",
      }}
    >
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>{label}</Text>
      <CurrencyDisplay amount={amount} tone={tone} style={{ marginTop: 6, ...theme.typography.metric }} />
      {subtitle ? (
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
