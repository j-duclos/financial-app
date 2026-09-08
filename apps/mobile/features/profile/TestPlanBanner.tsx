import React from "react";
import { Text, View } from "react-native";
import { testPlanIndicatorLabel } from "@budget-app/shared";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { useTheme } from "@/theme";

export function TestPlanBanner() {
  const theme = useTheme();
  const { billing } = useBillingStatus({ enabled: typeof __DEV__ !== "undefined" && __DEV__ });
  const label = testPlanIndicatorLabel(billing, typeof __DEV__ !== "undefined" && __DEV__);
  if (!label) return null;
  return (
    <View
      style={{
        backgroundColor: theme.colors.warningBg,
        paddingVertical: 4,
        paddingHorizontal: theme.spacing.lg,
      }}
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      testID="test-plan-indicator"
    >
      <Text
        style={{
          color: theme.colors.text,
          textAlign: "center",
          fontSize: 12,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
