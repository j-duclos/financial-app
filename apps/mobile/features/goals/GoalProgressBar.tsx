import React from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";

type Props = {
  percent: number;
  /** Thinner bar for compact Dashboard summaries. */
  thin?: boolean;
};

export function GoalProgressBar({ percent, thin }: Props) {
  const theme = useTheme();
  const clamped = Math.min(100, Math.max(0, percent));
  // Fabric requires accessibilityValue.now as an integer (long long).
  const accessibilityNow = Math.round(clamped);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: accessibilityNow }}
      style={{
        height: thin ? 4 : 8,
        borderRadius: 999,
        backgroundColor: theme.colors.surfaceMuted,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${clamped}%`,
          height: "100%",
          backgroundColor: theme.colors.tint,
          borderRadius: 999,
        }}
      />
    </View>
  );
}
