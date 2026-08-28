import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransaction,
  createTransfer,
  getTransaction,
  updateTransaction,
} from "@budget-app/api-client";
import { getEffectiveDisplayName } from "@budget-app/shared";
import { AppHeader, Button, Card, ErrorState, Screen, TextField } from "@/components/ui";
import { useTheme } from "@/theme";
import {
  coerceToInputDate,
  formatDateInput,
  formatIsoDateForInput,
  parseInputDateToIso,
  todayInputDate,
} from "@/lib/dates";
import { resolveHouseholdId } from "@/lib/householdContext";
import { isTransferCategoryName } from "@/lib/transactionsLedger";
import { transactionEditLockMessage } from "@/lib/transactionStatus";
import { describeApiError, fieldErrorsFromApiError } from "@/services/apiErrors";
import { refreshAfterTransactionEdit } from "@/lib/financialQueryRefresh";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useAccountOptions } from "@/hooks/useAccountOptions";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { transactionQueryKeys } from "./queryKeys";

type FormState = {
  account_id: number | "";
  date: string;
  payee: string;
  amount: string;
  direction: "INFLOW" | "OUTFLOW";
  category_id: number | "";
  memo: string;
  transfer_to_account_id: number | "";
};

const emptyForm = (accountId?: number): FormState => ({
  account_id: accountId ?? "",
  date: todayInputDate(),
  payee: "",
  amount: "",
  direction: "OUTFLOW",
  category_id: "",
  memo: "",
  transfer_to_account_id: "",
});

export function TransactionFormScreen() {
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    account?: string;
    id?: string;
    mode?: string;
    from?: string;
    to?: string;
    amount?: string;
    date?: string;
  }>();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId != null && editId > 0;
  const prefillAccount = Number(params.account);
  const transferMode = params.mode === "transfer";
  const presetFrom = Number(params.from);
  const presetTo = Number(params.to);

  const [form, setForm] = useState<FormState>(() =>
    emptyForm(Number.isInteger(prefillAccount) && prefillAccount > 0 ? prefillAccount : undefined)
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const txnQuery = useQuery({
    queryKey: transactionQueryKeys.detail(editId ?? 0),
    queryFn: () => getTransaction(editId as number),
    enabled: isEdit,
  });

  const { householdId: defaultHouseholdId } = useDefaultHouseholdId();
  const { accounts } = useAccountOptions({ householdId: defaultHouseholdId });
  const householdId = resolveHouseholdId(
    defaultHouseholdId,
    typeof form.account_id === "number" ? form.account_id : null,
    accounts
  );
  const { categories } = useCategoryOptions({ householdId });
  const selectedCategory = categories.find((c) => c.id === form.category_id);
  const isTransfer = isTransferCategoryName(selectedCategory?.name);

  useEffect(() => {
    if (isEdit || !transferMode) return;
    const fromId = Number.isInteger(presetFrom) && presetFrom > 0 ? presetFrom : null;
    const toId = Number.isInteger(presetTo) && presetTo > 0 ? presetTo : prefillAccount;
    if (!toId || !Number.isInteger(toId) || toId <= 0) return;
    setForm((prev) => ({
      ...prev,
      account_id: fromId ?? prev.account_id,
      transfer_to_account_id: toId,
      amount: params.amount?.trim() || prev.amount,
      date: params.date?.trim() ? coerceToInputDate(params.date) : prev.date,
      payee: prev.payee || "Transfer",
    }));
  }, [isEdit, transferMode, presetFrom, presetTo, prefillAccount, params.amount, params.date]);

  useEffect(() => {
    if (isEdit || !transferMode || categories.length === 0) return;
    const bankTransfer = categories.find((c) => c.name === "Bank Transfer");
    if (bankTransfer) {
      setForm((prev) =>
        prev.category_id === "" ? { ...prev, category_id: bankTransfer.id } : prev
      );
    }
  }, [isEdit, transferMode, categories]);

  useEffect(() => {
    const txn = txnQuery.data;
    if (!txn) return;
    const abs = Math.abs(parseFloat(txn.amount));
    setForm({
      account_id: txn.account?.id ?? txn.account_id ?? "",
      date: formatIsoDateForInput(txn.date),
      payee: txn.payee,
      amount: Number.isFinite(abs) ? String(abs) : "",
      direction: txn.direction,
      category_id: txn.category?.id ?? txn.category_id ?? "",
      memo: txn.memo ?? "",
      transfer_to_account_id: txn.transfer_to_account?.id ?? "",
    });
  }, [txnQuery.data]);

  const lockMessage = txnQuery.data
    ? transactionEditLockMessage(txnQuery.data, getEffectiveDisplayName(txnQuery.data.account))
    : null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (typeof form.account_id !== "number") throw new Error("Account is required");
      const isoDate = parseInputDateToIso(form.date);
      if (!isoDate) throw new Error("Enter a valid date (MM-DD-YYYY)");
      const signedAmount =
        form.direction === "OUTFLOW" ? `-${form.amount}` : form.amount;

      if (isTransfer && !isEdit) {
        if (typeof form.transfer_to_account_id !== "number") {
          throw new Error("Destination account is required for transfers");
        }
        return createTransfer({
          from_account: form.account_id,
          to_account: form.transfer_to_account_id,
          amount: form.amount,
          date: isoDate,
          payee: form.payee,
          memo: form.memo,
          from_category_id: typeof form.category_id === "number" ? form.category_id : null,
        });
      }

      const body = {
        account_id: form.account_id,
        date: isoDate,
        payee: form.payee,
        amount: signedAmount,
        category_id: typeof form.category_id === "number" ? form.category_id : null,
        memo: form.memo,
        ...(isEdit && isTransfer && typeof form.transfer_to_account_id === "number"
          ? { transfer_to_account_id: form.transfer_to_account_id }
          : {}),
      };

      if (isEdit && editId) {
        return updateTransaction(editId, body);
      }
      return createTransaction(body);
    },
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient);
      router.back();
    },
    onError: (err) => {
      const fields = fieldErrorsFromApiError(err);
      if (Object.keys(fields).length > 0) {
        setFieldErrors(fields);
        return;
      }
      const message = describeApiError(err);
      if (message.toLowerCase().includes("valid date")) {
        setFieldErrors((prev) => ({ ...prev, date: "Use MM-DD-YYYY" }));
        return;
      }
      Alert.alert("Save failed", message);
    },
  });

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const accountOptions = useMemo(
    () => accounts.map((a) => ({ id: a.id, label: getEffectiveDisplayName(a) })),
    [accounts]
  );

  if (isEdit && txnQuery.isLoading) {
    return (
      <Screen scroll>
        <AppHeader title="Edit transaction" onBack={() => router.back()} />
      </Screen>
    );
  }

  if (isEdit && txnQuery.isError) {
    return (
      <Screen scroll>
        <AppHeader title="Edit transaction" onBack={() => router.back()} />
        <ErrorState message={describeApiError(txnQuery.error)} onRetry={() => void txnQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <AppHeader title={isEdit ? "Edit transaction" : "Add transaction"} onBack={() => router.back()} />
      {lockMessage ? (
        <Text style={{ color: theme.colors.warning, ...theme.typography.caption, marginBottom: theme.spacing.md }}>
          {lockMessage}
        </Text>
      ) : null}

      <Card>
        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>Account</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {accountOptions.map((a) => (
              <Button
                key={a.id}
                label={a.label}
                variant={form.account_id === a.id ? "primary" : "secondary"}
                onPress={() => setField("account_id", a.id)}
              />
            ))}
          </View>
        </ScrollView>

        <TextField
          label="Date (MM-DD-YYYY)"
          value={form.date}
          onChangeText={(v) => setField("date", formatDateInput(v))}
          keyboardType="number-pad"
          maxLength={10}
          placeholder="MM-DD-YYYY"
          error={fieldErrors.date}
        />
        <TextField label="Payee" value={form.payee} onChangeText={(v) => setField("payee", v)} error={fieldErrors.payee} />
        <TextField label="Amount" value={form.amount} onChangeText={(v) => setField("amount", v)} keyboardType="decimal-pad" error={fieldErrors.amount} />

        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>Direction</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: theme.spacing.md }}>
          <Button label="Expense" variant={form.direction === "OUTFLOW" ? "primary" : "secondary"} onPress={() => setField("direction", "OUTFLOW")} />
          <Button label="Income" variant={form.direction === "INFLOW" ? "primary" : "secondary"} onPress={() => setField("direction", "INFLOW")} />
        </View>

        <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {categories.slice(0, 30).map((c) => (
              <Button
                key={c.id}
                label={c.name}
                variant={form.category_id === c.id ? "primary" : "secondary"}
                onPress={() => setField("category_id", c.id)}
              />
            ))}
          </View>
        </ScrollView>

        {isTransfer ? (
          <>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
              Transfer destination
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {accountOptions
                  .filter((a) => a.id !== form.account_id)
                  .map((a) => (
                    <Button
                      key={a.id}
                      label={a.label}
                      variant={form.transfer_to_account_id === a.id ? "primary" : "secondary"}
                      onPress={() => setField("transfer_to_account_id", a.id)}
                    />
                  ))}
              </View>
            </ScrollView>
          </>
        ) : null}

        <TextField label="Notes" value={form.memo} onChangeText={(v) => setField("memo", v)} multiline />
      </Card>

      <View style={{ marginTop: theme.spacing.lg }}>
        <Button
          label={isEdit ? "Save changes" : "Create transaction"}
          onPress={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
          disabled={Boolean(lockMessage?.includes("Reconciled"))}
        />
      </View>
    </Screen>
  );
}
