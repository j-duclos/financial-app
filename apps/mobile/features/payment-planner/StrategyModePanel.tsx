import React from "react";
import { Pressable, Text, View } from "react-native";
import type { DebtPayoffMode, DebtPayoffStrategy } from "@budget-app/shared";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  DEBT_MODE_OPTIONS,
  DEBT_STRATEGY_OPTIONS,
  debtModeDescription,
  debtModeLabel,
  debtStrategyDescription,
  debtStrategyLabel,
} from "./display";

type Props = {
  strategy: DebtPayoffStrategy;
  mode: DebtPayoffMode;
  onStrategyChange: (strategy: DebtPayoffStrategy) => void;
  onModeChange: (mode: DebtPayoffMode) => void;
};

export function StrategyModePanel({ strategy, mode, onStrategyChange, onModeChange }: Props) {
  const theme = useTheme();

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 8 }}>
        Strategy & mode
      </Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
        Payoff order
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {DEBT_STRATEGY_OPTIONS.map((opt) => (
          <Pill
            key={opt.id}
            label={opt.label}
            selected={strategy === opt.id}
            onPress={() => onStrategyChange(opt.id)}
            accessibilityHint={opt.description}
          />
        ))}
      </View>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
        Payoff mode
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {DEBT_MODE_OPTIONS.map((opt) => (
          <Pill
            key={opt.id}
            label={opt.label}
            selected={mode === opt.id}
            onPress={() => onModeChange(opt.id)}
            accessibilityHint={opt.description}
          />
        ))}
      </View>
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
        <Text style={{ fontWeight: "600" }}>{debtStrategyLabel(strategy)}:</Text>{" "}
        {debtStrategyDescription(strategy)}
      </Text>
      <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}>
        <Text style={{ fontWeight: "600" }}>{debtModeLabel(mode)}:</Text> {debtModeDescription(mode)}
      </Text>
    </Card>
  );
}

function Pill({
  label,
  selected,
  onPress,
  accessibilityHint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={accessibilityHint}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: selected ? theme.colors.tint : theme.colors.surfaceMuted,
        minHeight: theme.touchTarget,
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: selected ? theme.colors.surface : theme.colors.text,
          fontWeight: "600",
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
