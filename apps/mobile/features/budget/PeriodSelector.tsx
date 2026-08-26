import React from "react";
import { Pressable, Text, View } from "react-native";
import { IconButton } from "@/components/ui";
import { useTheme } from "@/theme";
import { formatPeriodLabel } from "./periodUtils";
import type { BudgetPeriodAnchor } from "./types";

type Props = {
  period: BudgetPeriodAnchor;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
};

export function PeriodSelector({ period, onPrev, onNext, onToday }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: theme.spacing.sm,
      }}
    >
      <IconButton name="chevron-left" accessibilityLabel="Previous period" onPress={onPrev} />
      <View style={{ alignItems: "center", flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
          {formatPeriodLabel(period)}
        </Text>
        <Pressable onPress={onToday} accessibilityRole="button" accessibilityLabel="Go to current period">
          <Text style={{ color: theme.colors.tint, fontSize: 12, fontWeight: "600", marginTop: 2 }}>Today</Text>
        </Pressable>
      </View>
      <IconButton name="chevron-right" accessibilityLabel="Next period" onPress={onNext} />
    </View>
  );
}
