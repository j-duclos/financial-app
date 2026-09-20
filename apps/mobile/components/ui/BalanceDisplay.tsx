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
      {hasInfo ? (
        <IconButton
          name="info-circle"
          size={16}
          accessibilityLabel={infoAccessibilityLabel}
          accessibilityHint={accessibilityHint}
          onPress={onInfoPress}
          style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
        />
      ) : null}
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={summaryLabel}
        accessibilityHint={hasInfo ? undefined : accessibilityHint}
      >
        <Text
          style={{
            color: theme.colors.textMuted,
            ...theme.typography.label,
            paddingRight: hasInfo ? 28 : 0,
          }}
        >
          {label}
        </Text>
        <CurrencyDisplay
          amount={amount}
          tone={tone}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          ellipsizeMode="clip"
          style={{
            marginTop: 6,
            ...theme.typography.metric,
            width: "100%",
          }}
        />
        {subtitle ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
