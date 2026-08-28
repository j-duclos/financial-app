import React, { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import type { Account, Category, ScenarioOneTimeEvent } from "@budget-app/shared";
import { formatAccountOptionLabel } from "@budget-app/shared";
import { BottomSheet, Button, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import { todayStr } from "@/lib/dates";
import { DatePickerField, OptionsPickerSheet, SelectField, type PickerOption } from "@/components/forms";
import type { EventPreset } from "../types";
import {
  createScenarioOneTimeEvent,
  updateScenarioOneTimeEvent,
} from "@budget-app/api-client";

type Props = {
  visible: boolean;
  preset: EventPreset;
  scenarioId: number;
  accounts: Account[];
  categories: Category[];
  existing?: ScenarioOneTimeEvent | null;
  onClose: () => void;
  onSaved: () => void;
};

type PickerKind = "account" | "to" | "category" | null;

export function OneTimeEventSheet({
  visible,
  preset,
  scenarioId,
  accounts,
  categories,
  existing,
  onClose,
  onSaved,
}: Props) {
  const theme = useTheme();
  const presetDirection = { income: "INCOME", expense: "EXPENSE", transfer: "TRANSFER" } as const;
  const isTransfer = preset === "transfer" || existing?.direction === "TRANSFER";

  const [date, setDate] = useState(existing?.date ?? todayStr());
  const [accountId, setAccountId] = useState(String(existing?.account?.id ?? existing?.account_id ?? ""));
  const [transferToId, setTransferToId] = useState(
    String(existing?.transfer_to_account?.id ?? existing?.transfer_to_account_id ?? "")
  );
  const [description, setDescription] = useState(existing?.description ?? "");
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [categoryId, setCategoryId] = useState(String(existing?.category?.id ?? existing?.category_id ?? ""));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerKind>(null);

  const title =
    existing != null
      ? "Edit change"
      : preset === "income"
        ? "Add one-time income"
        : preset === "expense"
          ? "Add one-time expense"
          : "Transfer money";

  const accountOptions: PickerOption[] = useMemo(
    () =>
      accounts
        .filter((a) => (isTransfer ? String(a.id) !== transferToId : true))
        .map((a) => ({
          id: String(a.id),
          title: formatAccountOptionLabel(a),
          searchText: formatAccountOptionLabel(a),
        })),
    [accounts, isTransfer, transferToId]
  );

  const toAccountOptions: PickerOption[] = useMemo(
    () =>
      accounts
        .filter((a) => String(a.id) !== accountId)
        .map((a) => ({
          id: String(a.id),
          title: formatAccountOptionLabel(a),
          searchText: formatAccountOptionLabel(a),
        })),
    [accounts, accountId]
  );

  const categoryOptions: PickerOption[] = useMemo(
    () => [
      { id: "", title: "None" },
      ...categories.map((c) => ({ id: String(c.id), title: c.name, searchText: c.name })),
    ],
    [categories]
  );

  const selectedAccount = accounts.find((a) => String(a.id) === accountId);
  const selectedTo = accounts.find((a) => String(a.id) === transferToId);
  const selectedCategory = categories.find((c) => String(c.id) === categoryId);

  const handleSubmit = async () => {
    if (!date || !amount) {
      setError("Date and amount are required.");
      return;
    }
    if (isTransfer) {
      if (!accountId || !transferToId || accountId === transferToId) {
        setError("Choose different from and to accounts.");
        return;
      }
    } else if (!accountId || !description.trim()) {
      setError("Account and description are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const toAccount = accounts.find((a) => a.id === Number(transferToId));
      const resolvedDescription = isTransfer
        ? description.trim() || (toAccount ? `Transfer to ${toAccount.name}` : "Transfer")
        : description.trim();
      const body = {
        date,
        account_id: Number(accountId),
        transfer_to_account_id: isTransfer ? Number(transferToId) : null,
        description: resolvedDescription,
        direction: (isTransfer ? "TRANSFER" : presetDirection[preset]) as "INCOME" | "EXPENSE" | "TRANSFER",
        amount: String(Math.abs(parseFloat(amount))),
        category_id: categoryId ? Number(categoryId) : null,
        notes,
      };
      if (existing) {
        await updateScenarioOneTimeEvent(existing.id, body);
      } else {
        await createScenarioOneTimeEvent(scenarioId, body);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save change.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BottomSheet visible={visible} title={title} onClose={onClose}>
        <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: theme.spacing.md }}>
          {error ? <Text style={{ color: theme.colors.critical }}>{error}</Text> : null}
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
            Scenario-only — does not create a real transaction.
          </Text>
          <DatePickerField label="Date" value={date} onChange={setDate} />
          {isTransfer ? (
            <>
              <SelectField
                label="From"
                value={selectedAccount ? formatAccountOptionLabel(selectedAccount) : null}
                placeholder="Select account"
                onPress={() => setPicker("account")}
              />
              <SelectField
                label="To"
                value={selectedTo ? formatAccountOptionLabel(selectedTo) : null}
                placeholder="Select account"
                onPress={() => setPicker("to")}
              />
            </>
          ) : (
            <SelectField
              label="Account"
              value={selectedAccount ? formatAccountOptionLabel(selectedAccount) : null}
              placeholder="Select account"
              onPress={() => setPicker("account")}
            />
          )}
          <TextField label="Description" value={description} onChangeText={setDescription} />
          <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          {!isTransfer ? (
            <SelectField
              label="Category"
              value={selectedCategory?.name ?? null}
              placeholder="Select category"
              onPress={() => setPicker("category")}
            />
          ) : null}
          <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} />
          <Button label="Save change" onPress={handleSubmit} loading={saving} />
        </ScrollView>
      </BottomSheet>

      <OptionsPickerSheet
        visible={picker === "account"}
        title={isTransfer ? "From account" : "Account"}
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
        visible={picker === "to"}
        title="To account"
        options={toAccountOptions}
        selectedId={transferToId || null}
        searchPlaceholder="Search accounts"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setTransferToId(id);
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
    </>
  );
}
