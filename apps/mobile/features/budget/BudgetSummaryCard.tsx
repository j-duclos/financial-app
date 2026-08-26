import React from "react";
import { Text, View } from "react-native";
import { formatCurrency } from "@budget-app/shared";
import type { SpendingTargetsSummary } from "@budget-app/shared";
import { Card, CurrencyDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import { spendingTargetsRemainingFromSummary } from "./spendingTargetDisplay";

type Props = {
  summary: SpendingTargetsSummary;
};

export function BudgetSummaryCard({ summary }: Props) {
  const theme = useTheme();
  const remaining = spendingTargetsRemainingFromSummary(summary);

  const metrics = [
    { label: "Total limits", amount: summary.total_monthly_targets },
    { label: "Spent", amount: summary.spent_so_far_total },
    { label: "Upcoming", amount: summary.scheduled_in_period_total ?? "0" },
    {
      label: "Remaining",
      amount: String(remaining),
      tone: remaining < 0 ? ("negative" as const) : ("positive" as const),
    },
  ];

  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md }}>
        {metrics.map((m) => (
          <View key={m.label} style={{ minWidth: "42%" }}>
            <Text style={{ color: theme.colors.textMuted, fontSize: 11, fontWeight: "600" }}>{m.label}</Text>
            <CurrencyDisplay amount={m.amount} tone={m.tone} style={{ fontSize: 18 }} />
          </View>
        ))}
      </View>
      <View
        style={{
          marginTop: theme.spacing.md,
          paddingTop: theme.spacing.sm,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
          Over limit: {summary.above_target_count}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>
          Approaching: {summary.approaching_target_count}
        </Text>
      </View>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11, marginTop: 8 }}>
        Totals use posted spending plus known scheduled transactions (backend-calculated).
      </Text>
    </Card>
  );
}
