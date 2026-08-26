import React from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { comparisonTone } from "../reportDisplay";

type Props = {
  text: string;
  delta?: string;
  style?: StyleProp<ViewStyle>;
};

export function PeriodComparisonBadge({ text, delta, style }: Props) {
  const theme = useTheme();
  const tone = comparisonTone(delta);
  const color =
    tone === "positive"
      ? theme.colors.moneyPositive
      : tone === "negative"
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
