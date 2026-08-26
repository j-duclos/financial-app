import React from "react";
import { Pressable, Text, View } from "react-native";
import type { ScenarioComparisonResponse } from "@budget-app/shared";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";
import { buildDetailedImpactRows, DETAILED_IMPACT_NO_CHANGE } from "../display";

type Props = {
  comparison: ScenarioComparisonResponse | undefined;
  expanded: boolean;
  onToggle: () => void;
};

export function DetailedImpactSection({ comparison, expanded, onToggle }: Props) {
  const theme = useTheme();
  if (!comparison?.metrics) return null;

  const rows = buildDetailedImpactRows(comparison);
  const hasContent = rows.some((r) => r.change !== DETAILED_IMPACT_NO_CHANGE && r.change !== "—");
  if (!hasContent && !expanded) return null;

  return (
    <View style={{ marginBottom: theme.spacing.md }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? "Hide detailed impact" : "Show detailed impact"}
      >
        <Text style={{ color: theme.colors.tint, fontWeight: "600", fontSize: 15 }}>
          {expanded ? "▾ Hide detailed impact" : "▸ Show detailed impact"}
        </Text>
      </Pressable>
      {expanded ? (
        <Card style={{ marginTop: theme.spacing.sm }}>
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 12 }}>
            What this plan looks like over your forecast period — scenario values only.
          </Text>
          {rows.map((row) => (
            <View
              key={row.key}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingVertical: 8,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.textSecondary, flex: 1, fontSize: 14 }}>{row.label}</Text>
              <Text
                style={{
                  color: row.change === DETAILED_IMPACT_NO_CHANGE ? theme.colors.textMuted : theme.colors.text,
                  fontWeight: "600",
                  flex: 1,
                  textAlign: "right",
                  fontSize: 14,
                }}
              >
                {row.change}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
