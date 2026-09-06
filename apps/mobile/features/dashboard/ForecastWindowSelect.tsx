import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  FORECAST_WINDOW_LABELS,
  forecastPickerRows,
  lockedForecastUpsellMessage,
  type OperationalForecastDays,
} from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";
import { useBillingStatus } from "@/hooks/useBillingStatus";
import { usePremiumUpgrade } from "@/hooks/usePremiumUpgrade";

type OptionListProps = {
  value: OperationalForecastDays;
  onChange: (days: OperationalForecastDays) => void;
  onClose: () => void;
};

export function ForecastWindowOptionList({ value, onChange, onClose }: OptionListProps) {
  const theme = useTheme();
  const { billing } = useBillingStatus();
  const { promptUpgrade } = usePremiumUpgrade();
  const rows = forecastPickerRows(billing);

  return (
    <>
      {rows.map((row) => {
        const selected = !row.locked && row.days === value;
        return (
          <Pressable
            key={row.days}
            onPress={() => {
              if (row.locked) {
                promptUpgrade("Premium forecast", lockedForecastUpsellMessage(row.days));
                return;
              }
              onChange(row.days);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: row.locked }}
            accessibilityLabel={
              row.locked ? `${row.label}, Premium` : row.label
            }
            style={{
              minHeight: theme.touchTarget,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              opacity: row.locked ? 0.85 : 1,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 16 }}>{row.label}</Text>
            {row.locked ? (
              <Text style={{ color: theme.colors.textMuted, fontWeight: "700" }}>Premium</Text>
            ) : selected ? (
              <Text style={{ color: theme.colors.tint, fontWeight: "700" }}>Selected</Text>
            ) : null}
          </Pressable>
        );
      })}
    </>
  );
}

type Props = {
  value: OperationalForecastDays;
  onChange: (days: OperationalForecastDays) => void;
  /** True while a new forecast window is loading but prior data may still be visible. */
  updating?: boolean;
};

export function ForecastWindowSelect({ value, onChange, updating }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const label = useMemo(() => FORECAST_WINDOW_LABELS[value], [value]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Forecast window ${label}`}
        style={{
          minHeight: theme.touchTarget,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface,
          justifyContent: "center",
        }}
      >
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.label }}>Forecast</Text>
        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
          {label}
          {updating ? " · Updating…" : ""}
        </Text>
      </Pressable>

      <BottomSheet visible={open} title="Forecast window" onClose={() => setOpen(false)}>
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 12 }}>
          Applies to this screen only. Your saved default is unchanged.
        </Text>
        <ForecastWindowOptionList
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
        <View style={{ height: 8 }} />
      </BottomSheet>
    </>
  );
}
