import React from "react";
import { Text, View } from "react-native";
import { CurrencyDisplay } from "./CurrencyDisplay";
import { IconButton } from "./IconButton";
import { useTheme, type FinancialTone } from "@/theme";

type Props = {
  label: string;
  amount: string | number;
  subtitle?: string;
  tone?: FinancialTone;
  accessibilityHint?: string;
  /** Span the full row — used for the mobile Available Credit companion tile. */
  fullWidth?: boolean;
  infoAccessibilityLabel?: string;
  onInfoPress?: () => void;
};

/** Compact balance/metric tile used on Dashboard and summaries. */
export function BalanceDisplay({
  label,
  amount,
  subtitle,
  tone,
  accessibilityHint,
  fullWidth = false,
  infoAccessibilityLabel,
  onInfoPress,
}: Props) {
  const theme = useTheme();
  const hasInfo = Boolean(infoAccessibilityLabel && onInfoPress);
  const summaryLabel = `${label}: ${amount}${subtitle ? `. ${subtitle}` : ""}`;
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        padding: theme.spacing.lg,
        flex: 1,
        minWidth: fullWidth ? "100%" : "46%",
        alignSelf: fullWidth ? "stretch" : undefined,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={summaryLabel}
          accessibilityHint={hasInfo ? undefined : accessibilityHint}
          style={{ flex: 1, paddingRight: hasInfo ? 4 : 0 }}
        >
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>{label}</Text>
          <CurrencyDisplay amount={amount} tone={tone} style={{ marginTop: 6, ...theme.typography.metric }} />
          {subtitle ? (
            <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {hasInfo ? (
          <IconButton
            name="info-circle"
            size={16}
            accessibilityLabel={infoAccessibilityLabel}
            accessibilityHint={accessibilityHint}
            onPress={onInfoPress}
            style={{ marginTop: -8, marginRight: -8 }}
          />
        ) : null}
      </View>
    </View>
  );
}
