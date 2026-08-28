import React, { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import type { Account, Category, RecurringRule, ScenarioRuleOverride } from "@budget-app/shared";
import { formatAccountOptionLabel, formatCurrency } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  DatePickerField,
  EndsDateField,
  OptionsPickerSheet,
  SelectField,
  type PickerOption,
} from "@/components/forms";
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

type PickerKind = "rule" | "status" | "account" | "category" | null;

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
  const [startDate, setStartDate] = useState<string | null>(existing?.override_start_date ?? null);
  const [endDate, setEndDate] = useState<string | null>(existing?.override_end_date ?? null);
  const [accountId, setAccountId] = useState(String(existing?.override_account?.id ?? ""));
  const [categoryId, setCategoryId] = useState(String(existing?.override_category?.id ?? ""));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind>(null);

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

  const selectedRule = ruleOptions.find((r) => String(r.id) === ruleId) ?? existing?.rule;
  const selectedAccount = accounts.find((a) => String(a.id) === accountId);
  const selectedCategory = categories.find((c) => String(c.id) === categoryId);
  const statusLabel =
    active === "true" ? "Keep active" : active === "false" ? "Cancel / pause" : "No change";

  const rulePickerOptions: PickerOption[] = useMemo(
    () =>
      ruleOptions.map((r) => ({
        id: String(r.id),
        title: r.name,
        subtitle: formatCurrency(r.amount, r.currency),
        searchText: `${r.name} ${r.amount}`,
      })),
    [ruleOptions]
  );

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
        override_start_date: context === "paycheck" && !startDate ? null : startDate || null,
        override_end_date: endDate || null,
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
    <>
      <BottomSheet visible={visible} title={title} onClose={onClose}>
        <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: theme.spacing.md }}>
          {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
            Overrides the simulation only — your real recurring rule stays unchanged.
          </Text>
          {mode === "add" ? (
            <SelectField
              label={context === "paycheck" ? "Income source" : "Bill or expense"}
              value={
                selectedRule
                  ? `${selectedRule.name} (${formatCurrency(selectedRule.amount, selectedRule.currency)})`
                  : null
              }
              placeholder="Select…"
              onPress={() => setPicker("rule")}
            />
          ) : selectedRule ? (
            <Text style={{ color: theme.colors.textSecondary }}>
              {selectedRule.name} · current {formatCurrency(selectedRule.amount, selectedRule.currency)}
            </Text>
          ) : null}
          <TextField
            label={context === "paycheck" ? "New amount" : "New amount"}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <SelectField label="Status" value={statusLabel} onPress={() => setPicker("status")} />
          <DatePickerField
            label="Starts"
            value={startDate}
            placeholder="Optional"
            onChange={setStartDate}
          />
          <EndsDateField value={endDate} onChange={setEndDate} />
          <SelectField
            label="Account"
            value={selectedAccount ? formatAccountOptionLabel(selectedAccount) : null}
            placeholder="No change"
            onPress={() => setPicker("account")}
          />
          <SelectField
            label="Category"
            value={selectedCategory?.name ?? null}
            placeholder="No change"
            onPress={() => setPicker("category")}
          />
          <TextField label="Notes" value={notes} onChangeText={setNotes} />
          <Button label="Save change" onPress={handleSubmit} loading={saving} />
        </ScrollView>
      </BottomSheet>

      <OptionsPickerSheet
        visible={picker === "rule"}
        title={context === "paycheck" ? "Income source" : "Bill or expense"}
        options={rulePickerOptions}
        selectedId={ruleId || null}
        searchPlaceholder="Search"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setRuleId(id);
          setPicker(null);
        }}
      />
      <OptionsPickerSheet
        visible={picker === "status"}
        title="Status"
        options={[
          { id: "", title: "No change" },
          { id: "true", title: "Keep active" },
          { id: "false", title: "Cancel / pause" },
        ]}
        selectedId={active}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setActive(id);
          setPicker(null);
        }}
      />
      <OptionsPickerSheet
        visible={picker === "account"}
        title="Account"
        options={[
          { id: "", title: "No change" },
          ...accounts.map((a) => ({
            id: String(a.id),
            title: formatAccountOptionLabel(a),
            searchText: formatAccountOptionLabel(a),
          })),
        ]}
        selectedId={accountId}
        searchPlaceholder="Search accounts"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setAccountId(id);
          setPicker(null);
        }}
      />
      <OptionsPickerSheet
        visible={picker === "category"}
        title="Category"
        options={[
          { id: "", title: "No change" },
          ...categories.map((c) => ({ id: String(c.id), title: c.name, searchText: c.name })),
        ]}
        selectedId={categoryId}
        searchPlaceholder="Search categories"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setCategoryId(id);
          setPicker(null);
        }}
      />
    </>
  );
}
