import React from "react";
import { Text, type TextProps } from "react-native";
import { formatCurrency } from "@budget-app/shared";
import { financialToneColors, useTheme, type FinancialTone } from "@/theme";

type Props = Omit<TextProps, "children"> & {
  amount: string | number;
  currency?: string;
  /** Override automatic positive/negative tone. */
  tone?: FinancialTone;
  showSign?: boolean;
};

function resolveTone(amount: string | number, override?: FinancialTone): FinancialTone {
  if (override) return override;
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n < 0 ? "negative" : "positive";
}

export function CurrencyDisplay({
  amount,
  currency = "USD",
  tone,
  showSign = false,
  style,
  ...rest
}: Props) {
  const theme = useTheme();
  const resolved = resolveTone(amount, tone);
  const colors = financialToneColors(theme, resolved);
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  let formatted = formatCurrency(amount, currency);
  if (showSign && Number.isFinite(n) && n > 0 && !formatted.startsWith("+")) {
    formatted = `+${formatted}`;
  }

  return (
    <Text
      accessibilityLabel={`${colors.label} amount ${formatted}`}
      style={[{ color: colors.fg, fontWeight: "700", fontSize: 20 }, style]}
      {...rest}
    >
      {formatted}
    </Text>
  );
}

export function moneyToneFromAmount(amount: string | number): FinancialTone {
  return resolveTone(amount);
}
