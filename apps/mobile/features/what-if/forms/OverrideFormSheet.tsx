import React, { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import type { Account, Category, RecurringRule, ScenarioRuleOverride } from "@budget-app/shared";
import { formatAccountOptionLabel, formatCurrency } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { ChipRow } from "../components/ChipRow";
import type { OverrideContext } from "../types";
import { createScenarioOverride, updateScenarioOverride } from "@budget-app/api-client";

type Props = {
  visible: boolean;
  mode: "add" | "edit";
  context: OverrideContext;
  existing: ScenarioRuleOverride | null;
  rules: RecurringRule[];
  accounts: Account[];
  categories: Category[];
  scenarioId: number;
  onClose: () => void;
  onSaved: () => void;
};

export function OverrideFormSheet({
  visible,
  mode,
  context,
  existing,
  rules,
  accounts,
  categories,
  scenarioId,
  onClose,
  onSaved,
}: Props) {
  const theme = useTheme();
  const [ruleId, setRuleId] = useState(String(existing?.rule?.id ?? ""));
  const [amount, setAmount] = useState(existing?.override_amount ?? "");
  const [active, setActive] = useState(
    existing?.override_active === false ? "false" : existing?.override_active === true ? "true" : ""
  );
  const [startDate, setStartDate] = useState(existing?.override_start_date ?? "");
  const [endDate, setEndDate] = useState(existing?.override_end_date ?? "");
  const [accountId, setAccountId] = useState(String(existing?.override_account?.id ?? ""));
  const [categoryId, setCategoryId] = useState(String(existing?.override_category?.id ?? ""));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ruleOptions = useMemo(() => {
    let filtered = rules;
    if (context === "paycheck") filtered = rules.filter((r) => r.direction === "INCOME");
    else if (context === "expense_change") filtered = rules.filter((r) => r.direction === "EXPENSE");
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [context, rules]);

  const title =
    mode === "add"
      ? context === "paycheck"
        ? "Change paycheck"
        : "Change current expense"
      : context === "paycheck"
        ? "Edit paycheck change"
        : "Edit expense change";

  const handleSubmit = async () => {
    if (mode === "add" && !ruleId) {
      setError("Select a recurring item.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        rule_id: Number(ruleId || existing?.rule?.id),
        override_amount: amount === "" ? null : String(amount),
        override_active: active === "" ? null : active === "true",
        override_start_date: context === "paycheck" && !startDate.trim() ? null : startDate.trim() || null,
        override_end_date: endDate.trim() || null,
        override_account_id: accountId ? Number(accountId) : null,
        override_category_id: categoryId ? Number(categoryId) : null,
        notes,
      };
      if (mode === "add") {
        await createScenarioOverride(scenarioId, body);
      } else if (existing) {
        await updateScenarioOverride(existing.id, body);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save override.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: theme.spacing.md }}>
        {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
          Overrides the simulation only — your real recurring rule stays unchanged.
        </Text>
        {mode === "add" ? (
          <ChipRow
            label={context === "paycheck" ? "Paycheck or income" : "Bill or expense"}
            options={[
              { value: "", label: "Select…" },
              ...ruleOptions.map((r) => ({
                value: String(r.id),
                label: `${r.name} (${formatCurrency(r.amount, r.currency)})`,
              })),
            ]}
            selected={ruleId}
            onSelect={setRuleId}
          />
        ) : null}
        <TextField label="New amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <ChipRow
          label="Status"
          options={[
            { value: "", label: "No change" },
            { value: "true", label: "Keep active" },
            { value: "false", label: "Cancel / pause" },
          ]}
          selected={active}
          onSelect={setActive}
        />
        <TextField label="Start date (optional)" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" />
        <TextField label="End date (optional)" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" />
        <ChipRow
          label="Account (optional)"
          options={[
            { value: "", label: "None" },
            ...accounts.map((a) => ({ value: String(a.id), label: formatAccountOptionLabel(a) })),
          ]}
          selected={accountId}
          onSelect={setAccountId}
        />
        <ChipRow
          label="Category (optional)"
          options={[
            { value: "", label: "None" },
            ...categories.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          selected={categoryId}
          onSelect={setCategoryId}
        />
        <TextField label="Notes" value={notes} onChangeText={setNotes} />
        <Button label="Save change" onPress={handleSubmit} loading={saving} />
      </ScrollView>
    </BottomSheet>
  );
}
