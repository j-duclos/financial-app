import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { CurrencyDisplay, StatusChip } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  formatNextRunDate,
  lifecycleStatusLabel,
  lifecycleStatusTone,
  type AutomationListRow,
} from "../automationDisplay";

type Props = {
  row: AutomationListRow;
  onPress: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
  toggleDisabled?: boolean;
};

export function AutomationRuleCard({ row, onPress, onToggleEnabled, toggleDisabled }: Props) {
  const theme = useTheme();
  const { rule, lifecycle, triggerSummary, actionSummary, cadenceSummary, nextRun } = row;
  const enabled = lifecycle === "running";

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${rule.name}. ${lifecycleStatusLabel(lifecycle)}. ${triggerSummary}. ${actionSummary}`}
      style={({ pressed }) => ({
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: pressed ? theme.colors.surfaceMuted : theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        gap: theme.spacing.sm,
        opacity: lifecycle === "ended" ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm }}>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 16 }} numberOfLines={1}>
            {rule.name}
          </Text>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }} numberOfLines={2}>
            {actionSummary}
          </Text>
          <Text style={{ color: theme.colors.textMuted, fontSize: 11 }} numberOfLines={1}>
            {cadenceSummary}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <CurrencyDisplay amount={rule.amount} style={{ fontSize: 16 }} />
          <StatusChip label={lifecycleStatusLabel(lifecycle)} tone={lifecycleStatusTone(lifecycle)} />
          <Text style={{ color: theme.colors.textSecondary, fontSize: 11 }}>
            Next {formatNextRunDate(nextRun)}
          </Text>
        </View>
      </View>

      {onToggleEnabled ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 4,
          }}
        >
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
            {enabled ? "Enabled" : "Disabled"}
          </Text>
          <Switch
            value={enabled}
            disabled={toggleDisabled || lifecycle === "ended"}
            onValueChange={onToggleEnabled}
            accessibilityLabel={`${enabled ? "Disable" : "Enable"} ${rule.name}`}
          />
        </View>
      ) : null}

      {rule.scheduled_change ? (
        <Text style={{ color: theme.colors.warning, fontSize: 12 }}>
          Scheduled change on {formatNextRunDate(rule.scheduled_change.effective_from.slice(0, 10))}
        </Text>
      ) : null}
    </Pressable>
  );
}
