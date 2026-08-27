import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { DebtPayoffMode, DebtPayoffStrategy } from "@budget-app/shared";
import { Card } from "@/components/ui";
import { OptionsPickerSheet, type PickerOption } from "@/features/recurring/OptionsPickerSheet";
import { useTheme } from "@/theme";
import {
  DEBT_MODE_OPTIONS,
  DEBT_STRATEGY_OPTIONS,
  debtModeLabel,
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
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);

  const strategyOptions: PickerOption[] = useMemo(
    () =>
      DEBT_STRATEGY_OPTIONS.map((o) => ({
        id: o.id,
        title: o.label,
        subtitle: o.description,
      })),
    []
  );
  const modeOptions: PickerOption[] = useMemo(
    () =>
      DEBT_MODE_OPTIONS.map((o) => ({
        id: o.id,
        title: o.label,
        subtitle: o.description,
      })),
    []
  );

  return (
    <>
      <Card style={{ marginBottom: theme.spacing.md, gap: 12 }}>
        <SelectRow
          label="Strategy"
          value={debtStrategyLabel(strategy)}
          onPress={() => setStrategyOpen(true)}
        />
        <SelectRow
          label="Payoff mode"
          value={debtModeLabel(mode)}
          onPress={() => setModeOpen(true)}
        />
      </Card>
      <OptionsPickerSheet
        visible={strategyOpen}
        title="Strategy"
        options={strategyOptions}
        selectedId={strategy}
        searchPlaceholder="Search strategies"
        onClose={() => setStrategyOpen(false)}
        onSelect={(id) => onStrategyChange(id as DebtPayoffStrategy)}
      />
      <OptionsPickerSheet
        visible={modeOpen}
        title="Payoff mode"
        options={modeOptions}
        selectedId={mode}
        searchPlaceholder="Search modes"
        onClose={() => setModeOpen(false)}
        onSelect={(id) => onModeChange(id as DebtPayoffMode)}
      />
    </>
  );
}

function SelectRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 6 }}>
        {label}
      </Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
        style={{
          minHeight: theme.touchTarget,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.md,
          paddingHorizontal: 12,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: theme.colors.surfaceMuted,
        }}
      >
        <Text style={{ flex: 1, color: theme.colors.text, fontWeight: "600" }} numberOfLines={1}>
          {value}
        </Text>
        <Text style={{ color: theme.colors.textMuted }}>›</Text>
      </Pressable>
    </View>
  );
}
