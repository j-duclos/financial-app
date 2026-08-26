import React from "react";
import { Text, View } from "react-native";
import { useTheme, financialToneColors } from "@/theme";
import type { FinancialTone } from "@/theme";

type Props = {
  label: string;
  baseline: string;
  scenario: string;
  delta?: string | null;
  tone?: FinancialTone;
};

/** Side-by-side baseline vs scenario metric with explicit labels for accessibility. */
export function BaselineScenarioMetric({ label, baseline, scenario, delta, tone }: Props) {
  const theme = useTheme();
  const deltaColors = delta ? financialToneColors(theme, tone ?? "neutral") : null;

  return (
    <View accessibilityRole="summary" accessibilityLabel={`${label}. Current plan: ${baseline}. What-if plan: ${scenario}.${delta ? ` Difference: ${delta}` : ""}`}>
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.label, marginBottom: 6 }}>
        {label}
      </Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>
            CURRENT
          </Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginTop: 2 }}>
            {baseline}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.tint, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 }}>
            WHAT-IF
          </Text>
          <Text style={{ color: theme.colors.text, ...theme.typography.bodyStrong, marginTop: 2 }}>
            {scenario}
          </Text>
        </View>
      </View>
      {delta ? (
        <View
          style={{
            marginTop: 8,
            alignSelf: "flex-start",
            backgroundColor: deltaColors?.bg,
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: theme.radius.sm,
          }}
        >
          <Text style={{ color: deltaColors?.fg, fontSize: 12, fontWeight: "700" }} accessibilityLabel={`Change: ${delta}`}>
            {delta}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
