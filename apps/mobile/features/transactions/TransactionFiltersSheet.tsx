import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  clearTransactionFiltersPreservingAccount,
  parseAmountFilterInput,
  type TransactionFilters,
} from "./types";
import { TIME_FILTER_LABELS, RECENT_RANGE_OPTIONS } from "@/lib/transactionsLedger";

type Props = {
  visible: boolean;
  draft: TransactionFilters;
  onClose: () => void;
  onApply: (filters: TransactionFilters) => void;
};

const TIME_FILTERS = RECENT_RANGE_OPTIONS;

export function TransactionFiltersSheet({
  visible,
  draft: initialDraft,
  onClose,
  onApply,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(initialDraft);
  const [amountMinInput, setAmountMinInput] = useState(
    initialDraft.amountMin != null ? String(initialDraft.amountMin) : ""
  );
  const [amountMaxInput, setAmountMaxInput] = useState(
    initialDraft.amountMax != null ? String(initialDraft.amountMax) : ""
  );

  useEffect(() => {
    if (visible) {
      setDraft(initialDraft);
      setAmountMinInput(initialDraft.amountMin != null ? String(initialDraft.amountMin) : "");
      setAmountMaxInput(initialDraft.amountMax != null ? String(initialDraft.amountMax) : "");
    }
  }, [visible, initialDraft]);

  const set = <K extends keyof TransactionFilters>(key: K, value: TransactionFilters[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: active ? theme.colors.tintMuted : theme.colors.surfaceMuted,
        borderWidth: 1,
        borderColor: active ? theme.colors.tint : theme.colors.border,
      }}
    >
      <Text style={{ color: active ? theme.colors.tint : theme.colors.text, ...theme.typography.caption }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <BottomSheet
      visible={visible}
      title="Filters"
      onClose={onClose}
      contentStyle={{ minHeight: "78%", maxHeight: "85%" }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: theme.spacing.md }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ gap: theme.spacing.lg }}>
            <View>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
                History range
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {TIME_FILTERS.map((tf) =>
                  chip(`time-${tf}`, TIME_FILTER_LABELS[tf], draft.timeFilter === tf, () =>
                    set("timeFilter", tf)
                  )
                )}
              </View>
            </View>

            <View>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
                Type
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {chip("flow-all", "All", draft.flow === "all", () => set("flow", "all"))}
                {chip("flow-income", "Income", draft.flow === "income", () => set("flow", "income"))}
                {chip("flow-expense", "Expense", draft.flow === "expense", () => set("flow", "expense"))}
                {chip("flow-transfer", "Transfer", draft.flow === "transfer", () => set("flow", "transfer"))}
              </View>
            </View>

            <View>
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
                Posted / forecast
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {chip("forecast-all", "All", draft.forecast === "all", () => set("forecast", "all"))}
                {chip("forecast-posted", "Posted", draft.forecast === "posted", () =>
                  set("forecast", "posted")
                )}
                {chip("forecast-forecast", "Forecast", draft.forecast === "forecast", () =>
                  set("forecast", "forecast")
                )}
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: theme.colors.text, ...theme.typography.body }}>Show reconciled</Text>
              <Switch value={draft.showReconciled} onValueChange={(v) => set("showReconciled", v)} />
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Min amount"
                  value={amountMinInput}
                  onChangeText={setAmountMinInput}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Max amount"
                  value={amountMaxInput}
                  onChangeText={setAmountMaxInput}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </View>
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            gap: 8,
            marginTop: theme.spacing.md,
            paddingBottom: Math.max(insets.bottom, theme.spacing.sm),
          }}
        >
          <View style={{ flex: 1 }}>
            <Button
              label="Clear"
              variant="secondary"
              onPress={() => {
                setDraft(clearTransactionFiltersPreservingAccount(initialDraft.accountId));
                setAmountMinInput("");
                setAmountMaxInput("");
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Apply"
              onPress={() =>
                onApply({
                  ...draft,
                  accountId: initialDraft.accountId,
                  amountMin: parseAmountFilterInput(amountMinInput),
                  amountMax: parseAmountFilterInput(amountMaxInput),
                })
              }
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}
