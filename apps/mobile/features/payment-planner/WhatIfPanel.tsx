import React from "react";
import { Pressable, Text, View } from "react-native";
import type { Account } from "@budget-app/shared";
import { getEffectiveDisplayName } from "@budget-app/shared";
import { Card, TextField } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  extraMonthly: string;
  lumpSum: string;
  lumpSumAccountId: number | null;
  creditCards: Account[];
  onExtraMonthlyChange: (value: string) => void;
  onLumpSumChange: (value: string) => void;
  onLumpSumAccountChange: (accountId: number | null) => void;
};

export function WhatIfPanel({
  extraMonthly,
  lumpSum,
  lumpSumAccountId,
  creditCards,
  onExtraMonthlyChange,
  onLumpSumChange,
  onLumpSumAccountChange,
}: Props) {
  const theme = useTheme();

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 4 }}>
        What-if scenarios
      </Text>
      <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 12 }}>
        Adjust extra payments to see updated projections from the server.
      </Text>
      <TextField
        label="Extra monthly payment"
        value={extraMonthly}
        onChangeText={onExtraMonthlyChange}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityHint="Additional amount applied monthly toward debt payoff"
      />
      <TextField
        label="One-time lump sum"
        value={lumpSum}
        onChangeText={onLumpSumChange}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityHint="Single extra payment applied once at plan start"
      />
      {lumpSum.trim() !== "" && Number(lumpSum) > 0 ? (
        <View style={{ marginBottom: theme.spacing.sm }}>
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.label, marginBottom: 6 }}>
            Apply lump sum to card
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {creditCards.map((card) => {
              const selected = lumpSumAccountId === card.id;
              return (
                <Pressable
                  key={card.id}
                  onPress={() => onLumpSumAccountChange(selected ? null : card.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: theme.radius.md,
                    borderWidth: 1,
                    borderColor: selected ? theme.colors.tint : theme.colors.border,
                    backgroundColor: selected ? theme.colors.tintMuted : theme.colors.surface,
                    minHeight: theme.touchTarget,
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: selected ? theme.colors.tint : theme.colors.text,
                      fontWeight: "600",
                      fontSize: 12,
                    }}
                  >
                    {getEffectiveDisplayName(card)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </Card>
  );
}
