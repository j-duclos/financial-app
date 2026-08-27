import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getEffectiveDisplayName } from "@budget-app/shared";
import type {
  Account,
  DebtPayoffCardSummary,
  DebtPayoffPlan,
  PayoffProjection,
  PayoffStrategy,
} from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  DRAWER_PAYOFF_STRATEGY_OPTIONS,
  drawerPayoffImpossibleMessage,
  drawerStrategyRequiresAmountInput,
  formatMoneyOrDash,
  targetUtilizationPercent,
} from "./display";
import { accountDetailPath, transactionsForAccountPath } from "./navigation";
import { formatDateDisplay } from "@/lib/dates";

type Props = {
  visible: boolean;
  account: Account;
  planCard: DebtPayoffCardSummary;
  globalPlan: DebtPayoffPlan | null | undefined;
  cardStrategy: PayoffStrategy;
  amountInput: string;
  onStrategyChange: (strategy: PayoffStrategy) => void;
  onAmountChange: (value: string) => void;
  onApplyCustomAmount: (amount: string) => void;
  projection: PayoffProjection | null | undefined;
  projectionLoading: boolean;
  projectionError: string | null;
  onClose: () => void;
};

export function DebtDetailSheet({
  visible,
  account,
  planCard,
  globalPlan: _globalPlan,
  cardStrategy,
  amountInput,
  onStrategyChange,
  onAmountChange,
  onApplyCustomAmount,
  projection,
  projectionLoading,
  projectionError,
  onClose,
}: Props) {
  const theme = useTheme();
  const router = useRouter();
  const targetUtil = targetUtilizationPercent(account);
  const utilPct = planCard.utilization_percent
    ? parseFloat(planCard.utilization_percent)
    : null;
  const [draftAmount, setDraftAmount] = useState(amountInput);

  useEffect(() => {
    setDraftAmount(amountInput);
  }, [amountInput]);

  useEffect(() => {
    if (cardStrategy !== "custom_amount") return;
    if (amountInput.trim()) return;
    const preset = planCard.suggested_payment || planCard.minimum_payment;
    if (preset) {
      onAmountChange(preset);
      onApplyCustomAmount(preset);
    }
  }, [cardStrategy, amountInput, planCard, onAmountChange, onApplyCustomAmount]);

  const metaParts = [
    `APR ${planCard.apr}%`,
    `Min ${formatMoneyOrDash(planCard.minimum_payment)}`,
  ];
  if (utilPct != null && Number.isFinite(utilPct)) {
    metaParts.push(`Utilization ${Math.round(utilPct)}%`);
  }

  const payoffLabel = (() => {
    if (projectionLoading) return null;
    if (projection && !projection.payoff_possible) {
      return "Won't shrink at current payment";
    }
    if (projection?.payoff_possible && projection.payoff_date) {
      return `Projected payoff: ${formatDateDisplay(projection.payoff_date)}`;
    }
    if (planCard.payoff_status === "non_amortizing") {
      return "Won't shrink at current payment";
    }
    if (planCard.payoff_date) {
      return `Projected payoff: ${formatDateDisplay(planCard.payoff_date)}`;
    }
    return "Not enough data to project";
  })();

  return (
    <BottomSheet visible={visible} title={getEffectiveDisplayName(account)} onClose={onClose}>
      <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 22 }}>
          {formatMoneyOrDash(planCard.balance)}
        </Text>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 4 }}>
          {metaParts.join(" · ")}
        </Text>

        <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 16, marginBottom: 8 }}>
          Payment
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {DRAWER_PAYOFF_STRATEGY_OPTIONS.map((opt) => {
            const selected = cardStrategy === opt.id;
            const label =
              opt.id === "minimum_payment"
                ? `Minimum ${formatMoneyOrDash(planCard.minimum_payment)}`
                : "Custom";
            return (
              <Pressable
                key={opt.id}
                onPress={() => onStrategyChange(opt.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: theme.radius.md,
                  backgroundColor: selected ? theme.colors.tint : theme.colors.surfaceMuted,
                }}
              >
                <Text
                  style={{
                    color: selected ? theme.colors.surface : theme.colors.text,
                    fontWeight: "600",
                    fontSize: 13,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {drawerStrategyRequiresAmountInput(cardStrategy) ? (
          <View style={{ marginBottom: 12 }}>
            <TextField
              label="Custom monthly payment"
              value={draftAmount}
              onChangeText={setDraftAmount}
              keyboardType="decimal-pad"
            />
            <Button
              label="Update scenario"
              variant="secondary"
              onPress={() => {
                onAmountChange(draftAmount);
                onApplyCustomAmount(draftAmount);
              }}
              disabled={draftAmount.trim() === "" || draftAmount === amountInput}
              style={{ marginTop: 8 }}
            />
          </View>
        ) : null}

        {projectionLoading ? (
          <ActivityIndicator color={theme.colors.tint} style={{ marginVertical: 12 }} />
        ) : projectionError ? (
          <Text style={{ color: theme.colors.critical, ...theme.typography.caption }}>
            {projectionError}
          </Text>
        ) : projection && !projection.payoff_possible ? (
          <Text
            style={{
              color: theme.colors.warning,
              ...theme.typography.caption,
              marginBottom: 8,
            }}
          >
            {drawerPayoffImpossibleMessage(planCard, projection)}
          </Text>
        ) : null}

        {payoffLabel ? (
          <View style={{ marginTop: 4, marginBottom: 12 }}>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>Payoff</Text>
            <Text
              style={{
                color:
                  projection && !projection.payoff_possible
                    ? theme.colors.warning
                    : theme.colors.text,
                fontWeight: "600",
                marginTop: 2,
              }}
            >
              {payoffLabel}
            </Text>
            {utilPct != null && Number.isFinite(utilPct) && utilPct > targetUtil ? (
              <Text
                style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 6 }}
              >
                Above your {targetUtil}% utilization target
              </Text>
            ) : null}
          </View>
        ) : null}

        <NavRow
          label="Account details"
          onPress={() => {
            onClose();
            router.push(accountDetailPath(account.id));
          }}
        />
        <NavRow
          label="View ledger"
          onPress={() => {
            onClose();
            router.push(
              transactionsForAccountPath(account.id, getEffectiveDisplayName(account))
            );
          }}
        />
      </ScrollView>
    </BottomSheet>
  );
}

function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        minHeight: theme.touchTarget,
        flexDirection: "row",
        alignItems: "center",
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingVertical: 12,
      }}
    >
      <Text style={{ flex: 1, color: theme.colors.text, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: theme.colors.textMuted }}>›</Text>
    </Pressable>
  );
}
