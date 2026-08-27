import React from "react";
import { Pressable, Text, View } from "react-native";
import type { DebtPayoffCardSummary } from "@budget-app/shared";
import { Card } from "@/components/ui";
import { useTheme } from "@/theme";
import { debtCardOutcomeLines, debtRowMetaLine, formatMoneyOrDash } from "./display";

type Props = {
  card: DebtPayoffCardSummary;
  selected?: boolean;
  showUtilization?: boolean;
  onPress: () => void;
};

export const DebtPriorityRow = React.memo(function DebtPriorityRow({
  card,
  selected,
  showUtilization = false,
  onPress,
}: Props) {
  const theme = useTheme();
  const outcomes = debtCardOutcomeLines(card);
  const order = card.payoff_order ?? "—";
  const util =
    showUtilization && card.utilization_percent
      ? `${card.utilization_percent}% utilization`
      : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={`${card.name}, priority ${order}, balance ${card.balance}`}
    >
      <Card
        style={{
          marginBottom: theme.spacing.sm,
          paddingVertical: 12,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.colors.tint : theme.colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <Text
            style={{
              color: theme.colors.textMuted,
              fontWeight: "700",
              fontSize: 15,
              minWidth: 18,
              marginTop: 1,
            }}
          >
            {order}
          </Text>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text
                style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15, flex: 1 }}
                numberOfLines={1}
              >
                {card.name}
              </Text>
              <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
                {formatMoneyOrDash(card.balance)}
              </Text>
            </View>
            <Text
              style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 2 }}
              numberOfLines={1}
            >
              {debtRowMetaLine(card)}
              {util ? ` · ${util}` : ""}
            </Text>
            <Text
              style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 4 }}
              numberOfLines={1}
            >
              {outcomes.headline}
            </Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
});
