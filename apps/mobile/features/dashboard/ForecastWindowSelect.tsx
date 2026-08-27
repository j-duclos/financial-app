import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  FORECAST_WINDOW_LABELS,
  OPERATIONAL_FORECAST_DAY_OPTIONS,
  type OperationalForecastDays,
} from "@budget-app/shared";
import { BottomSheet } from "@/components/ui";
import { useTheme } from "@/theme";

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
        {OPERATIONAL_FORECAST_DAY_OPTIONS.map((days) => {
          const selected = days === value;
          return (
            <Pressable
              key={days}
              onPress={() => {
                onChange(days);
                setOpen(false);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={{
                minHeight: theme.touchTarget,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: 16 }}>
                {FORECAST_WINDOW_LABELS[days]}
              </Text>
              {selected ? (
                <Text style={{ color: theme.colors.tint, fontWeight: "700" }}>Selected</Text>
              ) : null}
            </Pressable>
          );
        })}
        <View style={{ height: 8 }} />
      </BottomSheet>
    </>
  );
}
