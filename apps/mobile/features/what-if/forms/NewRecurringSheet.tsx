import React, { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import type { Account, Category, RecurringRuleFrequency } from "@budget-app/shared";
import { formatAccountOptionLabel } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { todayStr } from "@/lib/dates";
import {
  DatePickerField,
  EndsDateField,
  OptionsPickerSheet,
  SelectField,
  type PickerOption,
} from "@/components/forms";
import type { NewRecurringDirection } from "../types";
import { createScenarioAddedRecurring } from "@budget-app/api-client";

type Props = {
  visible: boolean;
  direction: NewRecurringDirection;
  scenarioId: number;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
};

const FREQUENCIES: { value: RecurringRuleFrequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "MONTHLY_DAY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

type PickerKind = "account" | "category" | "frequency" | null;

export function NewRecurringSheet({
  visible,
  direction,
  scenarioId,
  accounts,
  categories,
  onClose,
  onSaved,
}: Props) {
  const theme = useTheme();
  const isIncome = direction === "INCOME";
  const filteredCategories = categories.filter((c) =>
    isIncome ? c.category_type === "INCOME" : c.category_type === "EXPENSE"
  );
  const paymentAccounts = accounts.filter(
    (a) =>
      a.account_type === "CHECKING" ||
      a.account_type === "SAVINGS" ||
      a.account_type === "CASH" ||
      (!isIncome && a.account_type === "CREDIT")
  );

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [frequency, setFrequency] = useState<RecurringRuleFrequency>("MONTHLY_DAY");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind>(null);

  const accountOptions: PickerOption[] = useMemo(
    () =>
      paymentAccounts.map((a) => ({
        id: String(a.id),
        title: formatAccountOptionLabel(a),
        searchText: formatAccountOptionLabel(a),
      })),
    [paymentAccounts]
  );

  const categoryOptions: PickerOption[] = useMemo(
    () => [
      { id: "", title: "None" },
      ...filteredCategories.map((c) => ({ id: String(c.id), title: c.name, searchText: c.name })),
    ],
    [filteredCategories]
  );

  const selectedAccount = paymentAccounts.find((a) => String(a.id) === accountId);
  const selectedCategory = filteredCategories.find((c) => String(c.id) === categoryId);
  const frequencyLabel = FREQUENCIES.find((f) => f.value === frequency)?.label ?? frequency;

  const handleSubmit = async () => {
    if (!name.trim() || !amount.trim() || !accountId) {
      setError("Name, amount, and account are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createScenarioAddedRecurring(scenarioId, {
        name: name.trim(),
        account_id: Number(accountId),
        category_id: categoryId ? Number(categoryId) : null,
        direction,
        amount: String(Math.abs(parseFloat(amount))),
        currency: "USD",
        frequency,
        interval: 1,
        day_of_month: frequency === "MONTHLY_DAY" ? Number(dayOfMonth) : undefined,
        start_date: startDate,
        end_date: endDate || null,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add recurring change.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BottomSheet
        visible={visible}
        title={isIncome ? "New recurring income" : "New recurring expense"}
        onClose={onClose}
      >
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: theme.spacing.md }}>
          {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
            Adds to this what-if plan only — your current plan stays the same.
          </Text>
          <TextField label="Name" value={name} onChangeText={setName} />
          <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <SelectField
            label={isIncome ? "Deposit account" : "Paid from"}
            value={selectedAccount ? formatAccountOptionLabel(selectedAccount) : null}
            placeholder="Select account"
            onPress={() => setPicker("account")}
          />
          <SelectField
            label="Category"
            value={selectedCategory?.name ?? null}
            placeholder="Select category"
            onPress={() => setPicker("category")}
          />
          <SelectField
            label="Frequency"
            value={frequencyLabel}
            onPress={() => setPicker("frequency")}
          />
          {frequency === "MONTHLY_DAY" ? (
            <TextField
              label="Day of month"
              value={dayOfMonth}
              onChangeText={setDayOfMonth}
              keyboardType="number-pad"
            />
          ) : null}
          <DatePickerField label="Starts" value={startDate} onChange={setStartDate} />
          <EndsDateField value={endDate} onChange={setEndDate} />
          <Button label="Save change" onPress={handleSubmit} loading={saving} />
        </ScrollView>
      </BottomSheet>

      <OptionsPickerSheet
        visible={picker === "account"}
        title={isIncome ? "Deposit account" : "Paid from account"}
        options={accountOptions}
        selectedId={accountId || null}
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
        options={categoryOptions}
        selectedId={categoryId}
        searchPlaceholder="Search categories"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setCategoryId(id);
          setPicker(null);
        }}
      />
      <OptionsPickerSheet
        visible={picker === "frequency"}
        title="Frequency"
        options={FREQUENCIES.map((f) => ({ id: f.value, title: f.label }))}
        selectedId={frequency}
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setFrequency(id as RecurringRuleFrequency);
          setPicker(null);
        }}
      />
    </>
  );
}
