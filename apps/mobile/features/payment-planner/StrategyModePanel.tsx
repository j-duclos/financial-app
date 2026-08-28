import React, { useMemo, useState } from "react";
import type { DebtPayoffMode, DebtPayoffStrategy } from "@budget-app/shared";
import { Card } from "@/components/ui";
import { SelectField, OptionsPickerSheet, type PickerOption } from "@/components/forms";
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
        <SelectField
          label="Strategy"
          value={debtStrategyLabel(strategy)}
          onPress={() => setStrategyOpen(true)}
        />
        <SelectField
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
