import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { BottomSheet, Button } from "@/components/ui";
import { useTheme } from "@/theme";
import type { ReportFilters, ReportHistoryMonths } from "./types";
import { REPORT_HISTORY_OPTIONS } from "./types";

type Props = {
  visible: boolean;
  applied: ReportFilters;
  onClose: () => void;
  onApply: (filters: ReportFilters) => void;
};

export function ReportFiltersSheet({ visible, applied, onClose, onApply }: Props) {
  const theme = useTheme();
  const [draft, setDraft] = useState(applied);

  useEffect(() => {
    if (visible) setDraft(applied);
  }, [visible, applied]);

  const chip = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: selected ? theme.colors.tintMuted : theme.colors.surfaceMuted,
      }}
    >
      <Text
        style={{
          color: selected ? theme.colors.tint : theme.colors.text,
          fontWeight: "600",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <BottomSheet visible={visible} title="Report filters" onClose={onClose}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginBottom: 12 }}>
        Trend charts use this history window. Totals always reflect the selected month.
      </Text>

      <Text style={{ color: theme.colors.text, fontWeight: "700", marginBottom: 8 }}>Trend history</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {REPORT_HISTORY_OPTIONS.map((opt) =>
          chip(opt.label, draft.historyMonths === opt.value, () =>
            setDraft((d) => ({ ...d, historyMonths: opt.value as ReportHistoryMonths }))
          )
        )}
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Reset"
            variant="secondary"
            onPress={() => onApply({ ...applied, historyMonths: 12 })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Apply" onPress={() => onApply(draft)} />
        </View>
      </View>
    </BottomSheet>
  );
}
