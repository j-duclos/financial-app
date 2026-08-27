import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  DEFAULT_TRANSACTION_FILTERS,
  parseAmountFilterInput,
  type TransactionFilters,
} from "./types";
import { TIME_FILTER_LABELS, type TimeFilter } from "@/lib/transactionsLedger";
import type { Account, Category } from "@budget-app/shared";
import { getEffectiveDisplayName } from "@budget-app/shared";

type Props = {
  visible: boolean;
  draft: TransactionFilters;
  accounts: Account[];
  accountsLoading?: boolean;
  accountsError?: boolean;
  categories: Category[];
  categoriesLoading?: boolean;
  categoriesError?: boolean;
  onClose: () => void;
  onApply: (filters: TransactionFilters) => void;
};

const TIME_FILTERS = Object.keys(TIME_FILTER_LABELS) as TimeFilter[];

export function TransactionFiltersSheet({
  visible,
  draft: initialDraft,
  accounts,
  accountsLoading = false,
  accountsError = false,
  categories,
  categoriesLoading = false,
  categoriesError = false,
  onClose,
  onApply,
}: Props) {
  const theme = useTheme();
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

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
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
    <BottomSheet visible={visible} title="Filters" onClose={onClose}>
      <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
        <View style={{ gap: theme.spacing.lg }}>
          <View>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
              Account
            </Text>
            {accountsError ? (
              <Text style={{ color: theme.colors.warning, fontSize: 12, marginBottom: 6 }}>
                Could not load accounts — other filters still work.
              </Text>
            ) : null}
            {accountsLoading ? (
              <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 6 }}>
                Loading accounts…
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {chip("All accounts", draft.accountId == null, () => set("accountId", null))}
              {accounts.map((a) =>
                chip(getEffectiveDisplayName(a), draft.accountId === a.id, () => set("accountId", a.id))
              )}
            </View>
          </View>

          <View>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
              History range
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {TIME_FILTERS.map((tf) =>
                chip(TIME_FILTER_LABELS[tf], draft.timeFilter === tf, () => set("timeFilter", tf))
              )}
            </View>
          </View>

          <View>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
              Category
            </Text>
            {categoriesError ? (
              <Text style={{ color: theme.colors.warning, fontSize: 12, marginBottom: 6 }}>
                Could not load categories — other filters still work.
              </Text>
            ) : null}
            {categoriesLoading ? (
              <Text style={{ color: theme.colors.textMuted, fontSize: 12, marginBottom: 6 }}>
                Loading categories…
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {chip("All categories", draft.categoryId == null, () => set("categoryId", null))}
              {categories.slice(0, 20).map((c) =>
                chip(c.name, draft.categoryId === c.id, () => set("categoryId", c.id))
              )}
            </View>
          </View>

          <View>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
              Type
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {chip("All", draft.flow === "all", () => set("flow", "all"))}
              {chip("Income", draft.flow === "income", () => set("flow", "income"))}
              {chip("Expense", draft.flow === "expense", () => set("flow", "expense"))}
              {chip("Transfer", draft.flow === "transfer", () => set("flow", "transfer"))}
            </View>
          </View>

          <View>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
              Cleared
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {chip("All", draft.cleared === "all", () => set("cleared", "all"))}
              {chip("Cleared", draft.cleared === "cleared", () => set("cleared", "cleared"))}
              {chip("Pending", draft.cleared === "pending", () => set("cleared", "pending"))}
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: theme.colors.text, ...theme.typography.body }}>Show reconciled</Text>
            <Switch value={draft.showReconciled} onValueChange={(v) => set("showReconciled", v)} />
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <TextField label="Min amount" value={amountMinInput} onChangeText={setAmountMinInput} keyboardType="decimal-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="Max amount" value={amountMaxInput} onChangeText={setAmountMaxInput} keyboardType="decimal-pad" />
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 8, marginTop: theme.spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Clear"
            variant="secondary"
            onPress={() => {
              setDraft(DEFAULT_TRANSACTION_FILTERS);
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
                amountMin: parseAmountFilterInput(amountMinInput),
                amountMax: parseAmountFilterInput(amountMaxInput),
              })
            }
          />
        </View>
      </View>
    </BottomSheet>
  );
}
