import React from "react";
import { Text, View } from "react-native";
import { financialToneColors, useTheme, type FinancialTone } from "@/theme";

type Props = {
  label: string;
  tone?: FinancialTone;
};

export function StatusChip({ label, tone = "neutral" }: Props) {
  const theme = useTheme();
  const colors = financialToneColors(theme, tone);
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
      style={{
        alignSelf: "flex-start",
        backgroundColor: colors.bg,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: theme.radius.sm,
      }}
    >
      <Text style={{ color: colors.fg, fontSize: 11, fontWeight: "700" }}>{label}</Text>
    </View>
  );
}
