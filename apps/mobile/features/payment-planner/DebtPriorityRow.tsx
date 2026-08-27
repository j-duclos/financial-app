import React from "react";
import { Pressable, Text, View } from "react-native";
import { formatCurrency } from "@budget-app/shared";
import type { DebtPayoffCardSummary } from "@budget-app/shared";
import { Card, StatusChip, UtilizationDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import { debtCardOutcomeLines, priorityReasonLabel } from "./display";

type Props = {
  card: DebtPayoffCardSummary;
  selected?: boolean;
  targetUtilization?: number;
  onPress: () => void;
};

export const DebtPriorityRow = React.memo(function DebtPriorityRow({
  card,
  selected,
  targetUtilization,
  onPress,
}: Props) {
  const theme = useTheme();
  const outcomes = debtCardOutcomeLines(card);
  const priority = priorityReasonLabel(card);
  const isFirst = card.payoff_order === 1;
  const util = card.utilization_percent ? parseFloat(card.utilization_percent) : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={`${card.name}, priority ${card.payoff_order ?? "unknown"}, balance ${card.balance}`}
    >
      <Card
        style={{
          marginBottom: theme.spacing.sm,
          borderWidth: isFirst || selected ? 2 : 1,
          borderColor: isFirst || selected ? theme.colors.tint : theme.colors.border,
          backgroundColor: isFirst ? theme.colors.tintMuted : theme.colors.surface,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>{card.name}</Text>
            {isFirst ? (
              <StatusChip label="Pay first" tone="positive" />
            ) : card.payoff_order != null ? (
              <Text
                style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}
                accessibilityLabel={`Payoff order ${card.payoff_order}`}
              >
                Priority #{card.payoff_order}
              </Text>
            ) : null}
          </View>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 18 }}>
            {formatCurrency(card.balance)}
          </Text>
        </View>

        <Text style={{ color: theme.colors.tint, ...theme.typography.body, fontWeight: "600", marginTop: 8 }}>
          {outcomes.headline}
        </Text>
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 2 }}>
          {outcomes.suggestedLine}
        </Text>
        {priority ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 6 }}>
            {priority}
          </Text>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 12,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <Stat label="Minimum" value={formatCurrency(card.minimum_payment)} />
          <Stat label="APR" value={`${card.apr}%`} />
          {card.credit_limit ? (
            <Stat label="Limit" value={formatCurrency(card.credit_limit)} />
          ) : null}
          <Stat label="Interest/mo" value={formatCurrency(card.interest_this_month)} />
        </View>

        {util != null && targetUtilization != null ? (
          <View style={{ marginTop: 12 }}>
            <UtilizationDisplay value={util} warnAt={targetUtilization} label="Utilization" />
          </View>
        ) : null}

        {outcomes.interestLine ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 8 }}>
            {outcomes.interestLine}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ minWidth: "40%" }}>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{value}</Text>
    </View>
  );
}
