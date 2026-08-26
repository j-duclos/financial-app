import React from "react";
import { Text, View } from "react-native";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";
import type { RecurringRule } from "@budget-app/shared";
import { buildRuleSummary, triggerSummary, actionSummary } from "../automationDisplay";
import { ActionBadge, TriggerBadge } from "./RuleBadges";

type Props = {
  rule: RecurringRule;
};

export function RuleSummaryCard({ rule }: Props) {
  const theme = useTheme();
  const summary = buildRuleSummary(rule);

  return (
    <Card>
      <Text style={{ color: theme.colors.textSecondary, fontWeight: "600", marginBottom: 8 }}>
        Rule summary
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <TriggerBadge label="Schedule" />
        <ActionBadge label={rule.direction === "INCOME" ? "Create income" : rule.direction === "TRANSFER" ? "Transfer" : "Create expense"} />
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 15, lineHeight: 22 }} accessibilityRole="text">
        {summary}
      </Text>
      <View style={{ marginTop: 12, gap: 6 }}>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Trigger: {triggerSummary(rule)}</Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: 12 }}>Action: {actionSummary(rule)}</Text>
      </View>
    </Card>
  );
}
