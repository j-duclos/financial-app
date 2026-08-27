import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import {
  comparisonTone,
  comparisonToneForContext,
  type ComparisonTone,
} from "../reportDisplay";

type Props = {
  text: string;
  delta?: string;
  /** Prefer "expense" for spending category MoM so color is not misleading. */
  context?: "income" | "expense" | "net" | "neutral";
  tone?: ComparisonTone;
  style?: StyleProp<ViewStyle>;
};

export function PeriodComparisonBadge({ text, delta, context, tone, style }: Props) {
  const theme = useTheme();
  const resolved =
    tone ?? (context != null ? comparisonToneForContext(delta, context) : comparisonTone(delta));
  const color =
    resolved === "positive"
      ? theme.colors.moneyPositive
      : resolved === "negative"
        ? theme.colors.moneyNegative
        : theme.colors.textMuted;

  return (
    <View
      accessible
      accessibilityLabel={`Comparison: ${text}`}
      style={[{ flexDirection: "row", flexWrap: "wrap" }, style]}
    >
      <Text style={{ color, fontSize: 11, fontWeight: "500" }}>{text}</Text>
    </View>
  );
}
