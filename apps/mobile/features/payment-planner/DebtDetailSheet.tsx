import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import type {
  Account,
  DebtPayoffCardSummary,
  DebtPayoffPlan,
  PayoffProjection,
  PayoffStrategy,
} from "@budget-app/shared";
import { BottomSheet, Button, TextField, UtilizationDisplay } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  DRAWER_PAYOFF_STRATEGY_OPTIONS,
  drawerForecastRows,
  drawerPayoffImpossibleMessage,
  drawerStrategyRequiresAmountInput,
  targetUtilizationPercent,
  targetUtilizationPlanHint,
} from "./display";
import { accountDetailPath, transactionsForAccountPath } from "./navigation";

type Props = {
  visible: boolean;
  account: Account;
  planCard: DebtPayoffCardSummary;
  globalPlan: DebtPayoffPlan | null | undefined;
  cardStrategy: PayoffStrategy;
  amountInput: string;
  onStrategyChange: (strategy: PayoffStrategy) => void;
  onAmountChange: (value: string) => void;
  projection: PayoffProjection | null | undefined;
  projectionLoading: boolean;
  projectionError: string | null;
  onClose: () => void;
};

export function DebtDetailSheet({
  visible,
  account,
  planCard,
  globalPlan,
  cardStrategy,
  amountInput,
  onStrategyChange,
  onAmountChange,
  projection,
  projectionLoading,
  projectionError,
  onClose,
}: Props) {
  const theme = useTheme();
  const router = useRouter();
  const targetUtil = targetUtilizationPercent(account);
  const utilHint = targetUtilizationPlanHint(account);
  const forecastRows = drawerForecastRows(projection, planCard, globalPlan, amountInput);

  useEffect(() => {
    if (cardStrategy !== "custom_amount") return;
    if (amountInput.trim()) return;
    const preset = planCard.suggested_payment || planCard.minimum_payment;
    if (preset) onAmountChange(preset);
  }, [cardStrategy, amountInput, planCard, onAmountChange]);

  return (
    <BottomSheet visible={visible} title="Payment scenario" onClose={onClose}>
      <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>
          {getEffectiveDisplayName(account)}
        </Text>
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 22, marginTop: 4 }}>
          {formatCurrency(planCard.balance)}
        </Text>
        {planCard.priority_reason?.label ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 6 }}>
            {planCard.priority_reason.label}
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginVertical: 12 }}>
          <MiniStat label="Minimum" value={formatCurrency(planCard.minimum_payment)} />
          <MiniStat label="Recommended" value={`${formatCurrency(planCard.suggested_payment)}/mo`} />
          <MiniStat label="APR" value={`${planCard.apr}%`} />
        </View>

        {planCard.utilization_percent ? (
          <UtilizationDisplay
            value={parseFloat(planCard.utilization_percent)}
            warnAt={targetUtil}
            label="Utilization"
          />
        ) : null}
        {utilHint ? (
          <Text style={{ color: theme.colors.textSecondary, ...theme.typography.caption, marginTop: 6 }}>
            {utilHint}
          </Text>
        ) : null}

        <Text style={{ color: theme.colors.text, fontWeight: "600", marginTop: 16, marginBottom: 8 }}>
          Payment scenario (projection)
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {DRAWER_PAYOFF_STRATEGY_OPTIONS.map((opt) => (
            <Pressable
              key={opt.id}
              onPress={() => onStrategyChange(opt.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: cardStrategy === opt.id }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor:
                  cardStrategy === opt.id ? theme.colors.tint : theme.colors.surfaceMuted,
              }}
            >
              <Text
                style={{
                  color: cardStrategy === opt.id ? theme.colors.surface : theme.colors.text,
                  fontWeight: "600",
                  fontSize: 12,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {drawerStrategyRequiresAmountInput(cardStrategy) ? (
          <TextField
            label="Custom monthly payment"
            value={amountInput}
            onChangeText={onAmountChange}
            keyboardType="decimal-pad"
          />
        ) : null}

        {projectionLoading ? (
          <ActivityIndicator color={theme.colors.tint} style={{ marginVertical: 12 }} />
        ) : projectionError ? (
          <Text style={{ color: theme.colors.critical, ...theme.typography.caption }}>{projectionError}</Text>
        ) : projection && !projection.payoff_possible ? (
          <Text style={{ color: theme.colors.warning, ...theme.typography.caption, marginBottom: 8 }}>
            {drawerPayoffImpossibleMessage(planCard, projection)}
          </Text>
        ) : null}

        {forecastRows.length > 0 ? (
          <View style={{ marginTop: 8, gap: 8 }}>
            {forecastRows.map((row) => (
              <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                  {row.label}
                </Text>
                <Text
                  style={{
                    color:
                      row.accent === "positive"
                        ? theme.colors.moneyPositive
                        : row.accent === "warning"
                          ? theme.colors.warning
                          : theme.colors.text,
                    ...theme.typography.caption,
                    fontWeight: "600",
                  }}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: 12 }}>
          Scenario projection only — not a scheduled transaction.
        </Text>

        <View style={{ gap: 8, marginTop: 16 }}>
          <Button
            label="Account details"
            variant="secondary"
            onPress={() => {
              onClose();
              router.push(accountDetailPath(account.id));
            }}
          />
          <Button
            label="View transactions"
            variant="secondary"
            onPress={() => {
              onClose();
              router.push(transactionsForAccountPath(account.id));
            }}
          />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textMuted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{value}</Text>
    </View>
  );
}
