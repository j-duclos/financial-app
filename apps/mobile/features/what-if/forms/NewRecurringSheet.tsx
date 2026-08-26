import React, { useState } from "react";
import { ScrollView, Text } from "react-native";
import type { Account, Category, RecurringRuleFrequency } from "@budget-app/shared";
import { formatAccountOptionLabel } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { todayStr } from "@/lib/dates";
import { ChipRow } from "../components/ChipRow";
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
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <ChipRow
          label={isIncome ? "Deposit account" : "Paid from account"}
          options={paymentAccounts.map((a) => ({ value: String(a.id), label: formatAccountOptionLabel(a) }))}
          selected={accountId}
          onSelect={setAccountId}
        />
        <ChipRow
          label="Category (optional)"
          options={[
            { value: "", label: "None" },
            ...filteredCategories.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          selected={categoryId}
          onSelect={setCategoryId}
        />
        <ChipRow
          label="Frequency"
          options={[
            { value: "WEEKLY", label: "Weekly" },
            { value: "BIWEEKLY", label: "Biweekly" },
            { value: "MONTHLY_DAY", label: "Monthly" },
            { value: "YEARLY", label: "Yearly" },
          ]}
          selected={frequency}
          onSelect={(v) => setFrequency(v as RecurringRuleFrequency)}
        />
        {frequency === "MONTHLY_DAY" ? (
          <TextField label="Day of month" value={dayOfMonth} onChangeText={setDayOfMonth} keyboardType="number-pad" />
        ) : null}
        <TextField label="Start date" value={startDate} onChangeText={setStartDate} />
        <TextField label="End date (optional)" value={endDate} onChangeText={setEndDate} />
        <Button label={isIncome ? "Add income" : "Add expense"} onPress={handleSubmit} loading={saving} />
      </ScrollView>
    </BottomSheet>
  );
}
