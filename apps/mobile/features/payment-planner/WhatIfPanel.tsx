import React from "react";
import { Pressable, Text, View } from "react-native";
import type { Account, DebtPayoffMode } from "@budget-app/shared";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import { strategyNeedsExtraHint, survivalIgnoresExtraHint } from "@budget-app/shared/paymentPlannerDisplay";
import { Button, Card, TextField } from "@/components/ui";
import { useTheme } from "@/theme";

type Props = {
  creditCards: Account[];
  extraMonthly: string;
  lumpSum: string;
  lumpSumAccountId: number | null;
  mode: DebtPayoffMode;
  monthlyBudget?: string | null;
  onExtraMonthlyChange: (value: string) => void;
  onLumpSumChange: (value: string) => void;
  onLumpSumAccountChange: (accountId: number | null) => void;
  onSwitchToAggressive: () => void;
};

/**
 * Live what-if inputs. Debounce lives in the parent so one plan refetch
 * happens after typing settles — no separate apply button.
 */
export function WhatIfPanel({
  creditCards,
  extraMonthly,
  lumpSum,
  lumpSumAccountId,
  mode,
  monthlyBudget,
  onExtraMonthlyChange,
  onLumpSumChange,
  onLumpSumAccountChange,
  onSwitchToAggressive,
}: Props) {
  const theme = useTheme();
  const survivalBlocksExtra = survivalIgnoresExtraHint(mode, extraMonthly);
  const extraHint = strategyNeedsExtraHint(extraMonthly);
  const lumpNeedsCard = Number(lumpSum) > 0 && lumpSumAccountId == null;

  return (
    <Card style={{ marginBottom: theme.spacing.md }}>
      <Text style={{ color: theme.colors.text, ...theme.typography.headline, marginBottom: 4 }}>
        Adjust plan
      </Text>
      <Text
        style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginBottom: 12 }}
      >
        Changes apply as you type. Extra goes to the Pay first card.
      </Text>
      <TextField
        label="Extra per month"
        value={extraMonthly}
        onChangeText={onExtraMonthlyChange}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityHint="Additional amount applied monthly toward debt payoff"
      />
      {survivalBlocksExtra ? (
        <View
          style={{
            backgroundColor: theme.colors.warningBg,
            borderRadius: theme.radius.md,
            padding: 10,
            marginBottom: theme.spacing.sm,
          }}
        >
          <Text style={{ color: theme.colors.text, ...theme.typography.caption, marginBottom: 8 }}>
            Survival uses minimums only, so this extra isn&apos;t in the plan.
          </Text>
          <Button label="Switch to Aggressive payoff" onPress={onSwitchToAggressive} />
        </View>
      ) : extraHint ? (
        <Text
          style={{
            color: theme.colors.textSecondary,
            ...theme.typography.caption,
            marginBottom: theme.spacing.sm,
          }}
        >
          {extraHint}
        </Text>
      ) : null}
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
          {lumpNeedsCard ? (
            <Text
              style={{
                color: theme.colors.textSecondary,
                ...theme.typography.caption,
                marginTop: 6,
              }}
            >
              Pick a card so the lump sum is applied.
            </Text>
          ) : null}
        </View>
      ) : null}
      {monthlyBudget ? (
        <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption }}>
          This plan pays {formatCurrency(monthlyBudget)}/mo toward debt
          {mode === "survival" ? " (minimums only)" : ""}.
        </Text>
      ) : null}
    </Card>
  );
}
