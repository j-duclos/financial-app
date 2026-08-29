import React, { useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  getTransaction,
  listAccounts,
  updateTransaction,
} from "@budget-app/api-client";
import type { Account } from "@budget-app/shared";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import { AppHeader, Button, Card, ConfirmDialog, ErrorState, Screen, TextField } from "@/components/ui";
import { DatePickerField } from "@/components/forms/DatePickerField";
import { OptionsPickerSheet, type PickerOption } from "@/components/forms/OptionsPickerSheet";
import { SelectField } from "@/components/forms/SelectField";
import { useTheme } from "@/theme";
import {
  coerceToInputDate,
  parseInputDateToIso,
  todayStr,
} from "@/lib/dates";
import { resolveHouseholdId } from "@/lib/householdContext";
import { isTransferCategoryName } from "@/lib/transactionsLedger";
import {
  canDeleteTransaction,
  isTransferTransaction,
  transactionEditLockMessage,
} from "@/lib/transactionStatus";
import { describeApiError, fieldErrorsFromApiError } from "@/services/apiErrors";
import { refreshAfterTransactionEdit } from "@/lib/financialQueryRefresh";
import { useDefaultHouseholdId } from "@/hooks/useDefaultHouseholdId";
import { useCategoryOptions } from "@/hooks/useCategoryOptions";
import { resolvePostedCurrentBalance } from "@/features/accounts/accountBalanceDisplay";
import { transactionQueryKeys } from "./queryKeys";
import { TransferSourceBalancePreview } from "./TransferSourceBalancePreview";
import { isPlannedScheduledTransaction } from "./pendingSemantics";

type TransactionEntryType = "expense" | "income" | "transfer";

type FormState = {
  account_id: number | "";
  dateIso: string;
  payee: string;
  amount: string;
  entryType: TransactionEntryType;
  category_id: number | "";
  memo: string;
  transfer_to_account_id: number | "";
};

type PickerKind = "account" | "category" | "transferTo" | null;

function accountHouseholdId(account: Account | undefined): number | undefined {
  if (!account) return undefined;
  const h = account.household as Account["household"] | number | undefined;
  if (typeof h === "object" && h != null && "id" in h) return h.id;
  if (typeof h === "number") return h;
  return undefined;
}

const emptyForm = (accountId?: number): FormState => ({
  account_id: accountId ?? "",
  dateIso: todayStr(),
  payee: "",
  amount: "",
  entryType: "expense",
  category_id: "",
  memo: "",
  transfer_to_account_id: "",
});

function balanceSubtitle(account: Account | undefined): string | undefined {
  if (!account) return undefined;
  const amount = resolvePostedCurrentBalance(account);
  if (!amount) return undefined;
  return `Current balance ${formatCurrency(amount, account.currency ?? "USD")}`;
}

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
  const [picker, setPicker] = useState<PickerKind>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const txnQuery = useQuery({
    queryKey: transactionQueryKeys.detail(editId ?? 0),
    queryFn: () => getTransaction(editId as number),
    enabled: isEdit,
  });

  const { householdId: defaultHouseholdId } = useDefaultHouseholdId();
  const accountsQuery = useQuery({
    queryKey: ["transaction-form-accounts", defaultHouseholdId],
    queryFn: () =>
      listAccounts({
        balance: "true",
        active_only: true,
        household: defaultHouseholdId ?? undefined,
        page_size: 500,
      }),
    enabled: defaultHouseholdId != null,
    staleTime: 60_000,
  });
  const accounts = accountsQuery.data?.results ?? [];

  const householdId = resolveHouseholdId(
    defaultHouseholdId,
    typeof form.account_id === "number" ? form.account_id : null,
    accounts
  );
  const { categories } = useCategoryOptions({ householdId });

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === form.account_id) ?? null,
    [accounts, form.account_id]
  );
  const selectedDestAccount = useMemo(
    () => accounts.find((a) => a.id === form.transfer_to_account_id) ?? null,
    [accounts, form.transfer_to_account_id]
  );
  const selectedCategory = categories.find((c) => c.id === form.category_id);
  const isTransferEntry = form.entryType === "transfer" || isTransferCategoryName(selectedCategory?.name);
  const isCreditCardPayment =
    isTransferEntry && selectedDestAccount?.account_type === "CREDIT";

  const bankTransferCategory = useMemo(
    () => categories.find((c) => c.name === "Bank Transfer") ?? null,
    [categories]
  );
  const creditCardPaymentCategory = useMemo(
    () => categories.find((c) => c.name === "Credit Card Payment") ?? null,
    [categories]
  );

  useEffect(() => {
    if (isEdit || !transferMode) return;
    const fromId = Number.isInteger(presetFrom) && presetFrom > 0 ? presetFrom : null;
    const toId = Number.isInteger(presetTo) && presetTo > 0 ? presetTo : prefillAccount;
    if (!toId || !Number.isInteger(toId) || toId <= 0) return;
    setForm((prev) => ({
      ...prev,
      entryType: "transfer",
      account_id: fromId ?? prev.account_id,
      transfer_to_account_id: toId,
      amount: params.amount?.trim() || prev.amount,
      dateIso: params.date?.trim()
        ? /^\d{4}-\d{2}-\d{2}/.test(params.date.trim())
          ? params.date.trim().slice(0, 10)
          : coerceToInputDate(params.date)
        : prev.dateIso,
      payee: prev.payee || "Transfer",
    }));
  }, [isEdit, transferMode, presetFrom, presetTo, prefillAccount, params.amount, params.date]);

  useEffect(() => {
    if (isEdit || form.entryType !== "transfer" || categories.length === 0) return;
    const dest = selectedDestAccount;
    const nextCategory =
      dest?.account_type === "CREDIT" ? creditCardPaymentCategory : bankTransferCategory;
    if (nextCategory) {
      setForm((prev) =>
        prev.category_id === "" ? { ...prev, category_id: nextCategory.id } : prev
      );
    }
  }, [
    isEdit,
    form.entryType,
    categories.length,
    selectedDestAccount?.id,
    selectedDestAccount?.account_type,
    bankTransferCategory,
    creditCardPaymentCategory,
  ]);

  useEffect(() => {
    const txn = txnQuery.data;
    if (!txn) return;
    const abs = Math.abs(parseFloat(txn.amount));
    const xfer = isTransferCategoryName(txn.category?.name);
    setForm({
      account_id: txn.account?.id ?? txn.account_id ?? "",
      dateIso: txn.date.slice(0, 10),
      payee: txn.payee,
      amount: Number.isFinite(abs) ? String(abs) : "",
      entryType: xfer ? "transfer" : txn.direction === "INFLOW" ? "income" : "expense",
      category_id: txn.category?.id ?? txn.category_id ?? "",
      memo: txn.memo ?? "",
      transfer_to_account_id: txn.transfer_to_account?.id ?? "",
    });
  }, [txnQuery.data]);

  const lockMessage = txnQuery.data
    ? transactionEditLockMessage(txnQuery.data, getEffectiveDisplayName(txnQuery.data.account))
    : null;

  const showDeleteInForm =
    isEdit &&
    txnQuery.data != null &&
    canDeleteTransaction(txnQuery.data) &&
    !isPlannedScheduledTransaction(txnQuery.data);

  const deleteMutation = useMutation({
    mutationFn: () => deleteTransaction(editId as number),
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient);
      router.back();
    },
    onError: (err) => Alert.alert("Delete failed", describeApiError(err)),
  });

  const transferDestinations = useMemo((): Account[] => {
    if (!selectedAccount) return [];
    const hid = accountHouseholdId(selectedAccount);
    return accounts.filter((a) => {
      if (accountHouseholdId(a) !== hid) return false;
      return a.id !== selectedAccount.id;
    });
  }, [accounts, selectedAccount]);

  const accountPickerOptions = useMemo(
    (): PickerOption[] =>
      accounts.map((a) => ({
        id: String(a.id),
        title: getEffectiveDisplayName(a),
        subtitle: balanceSubtitle(a),
        searchText: getEffectiveDisplayName(a),
      })),
    [accounts]
  );

  const categoryPickerOptions = useMemo(
    (): PickerOption[] =>
      categories
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({
          id: String(c.id),
          title: c.name,
          searchText: c.name,
        })),
    [categories]
  );

  const transferDestOptions = useMemo(
    (): PickerOption[] =>
      transferDestinations.map((a) => ({
        id: String(a.id),
        title: getEffectiveDisplayName(a),
        subtitle: balanceSubtitle(a),
        searchText: getEffectiveDisplayName(a),
      })),
    [transferDestinations]
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (typeof form.account_id !== "number") throw new Error("Account is required");
      const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(form.dateIso)
        ? form.dateIso
        : parseInputDateToIso(form.dateIso);
      if (!isoDate) throw new Error("Enter a valid date");

      if (isTransferEntry && !isEdit) {
        if (typeof form.transfer_to_account_id !== "number") {
          throw new Error("Destination account is required for transfers");
        }
        if (form.transfer_to_account_id === form.account_id) {
          throw new Error("Choose two different accounts");
        }
        const xferCategory = isCreditCardPayment ? creditCardPaymentCategory : bankTransferCategory;
        return createTransfer({
          from_account: form.account_id,
          to_account: form.transfer_to_account_id,
          amount: form.amount,
          date: isoDate,
          payee:
            form.payee.trim() ||
            (isCreditCardPayment ? "Credit card payment" : "Transfer"),
          memo: form.memo,
          from_category_id:
            typeof form.category_id === "number"
              ? form.category_id
              : xferCategory?.id ?? null,
        });
      }

      const signedAmount =
        form.entryType === "income" ? form.amount : `-${form.amount}`;

      const body = {
        account_id: form.account_id,
        date: isoDate,
        payee: form.payee.trim() || "—",
        amount: signedAmount,
        category_id: typeof form.category_id === "number" ? form.category_id : null,
        memo: form.memo,
        ...(isEdit && isTransferEntry && typeof form.transfer_to_account_id === "number"
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

  const onSelectEntryType = (entryType: TransactionEntryType) => {
    setForm((prev) => ({
      ...prev,
      entryType,
      transfer_to_account_id: entryType === "transfer" ? prev.transfer_to_account_id : "",
      category_id: entryType === "transfer" ? "" : prev.category_id,
    }));
  };

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

  const typeChip = (label: string, type: TransactionEntryType) => (
    <View style={{ flex: 1 }}>
      <Button
        label={label}
        variant={form.entryType === type ? "primary" : "secondary"}
        onPress={() => onSelectEntryType(type)}
        disabled={isEdit && isTransferEntry && type !== "transfer"}
      />
    </View>
  );

  return (
    <Screen scroll>
      <AppHeader title={isEdit ? "Edit transaction" : "Add transaction"} onBack={() => router.back()} />
      {lockMessage ? (
        <Text style={{ color: theme.colors.warning, ...theme.typography.caption, marginBottom: theme.spacing.md }}>
          {lockMessage}
        </Text>
      ) : null}

      <Card>
        <View style={{ gap: theme.spacing.md }}>
        <SelectField
          label="Account"
          value={selectedAccount ? getEffectiveDisplayName(selectedAccount) : null}
          placeholder="Select account"
          onPress={() => setPicker("account")}
          error={fieldErrors.account_id}
        />
        {selectedAccount ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: -4 }}>
            {balanceSubtitle(selectedAccount) ?? "Balance unavailable"}
          </Text>
        ) : null}

        <DatePickerField
          label="Date"
          value={form.dateIso}
          onChange={(iso) => setField("dateIso", iso)}
        />

        {!isEdit ? (
          <>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
              Type
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: theme.spacing.sm }}>
              {typeChip("Expense", "expense")}
              {typeChip("Income", "income")}
              {typeChip("Transfer", "transfer")}
            </View>
          </>
        ) : null}

        <TextField
          label="Amount"
          value={form.amount}
          onChangeText={(v) => setField("amount", v)}
          keyboardType="decimal-pad"
          error={fieldErrors.amount}
        />

        <TextField
          label={isTransferEntry ? "Memo" : "Payee"}
          value={form.payee}
          onChangeText={(v) => setField("payee", v)}
          error={fieldErrors.payee}
          placeholder={isTransferEntry ? "Optional memo" : undefined}
        />

        {!isTransferEntry ? (
          <SelectField
            label="Category"
            value={selectedCategory?.name ?? null}
            placeholder="Select category"
            onPress={() => setPicker("category")}
            error={fieldErrors.category_id}
          />
        ) : null}

        {isTransferEntry ? (
          <>
            <SelectField
              label={isCreditCardPayment ? "To credit account" : "To account"}
              value={selectedDestAccount ? getEffectiveDisplayName(selectedDestAccount) : null}
              placeholder="Select account"
              onPress={() => setPicker("transferTo")}
              error={fieldErrors.transfer_to_account_id}
            />
            {selectedDestAccount ? (
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: -4 }}>
                {balanceSubtitle(selectedDestAccount) ?? "Balance unavailable"}
              </Text>
            ) : null}
            {isCreditCardPayment ? (
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption }}>
                Transfer / Card payment
              </Text>
            ) : null}
            {selectedAccount && form.dateIso ? (
              <TransferSourceBalancePreview
                sourceAccount={selectedAccount}
                transferDateIso={form.dateIso}
                transferAmount={form.amount}
                label={getEffectiveDisplayName(selectedAccount)}
              />
            ) : null}
          </>
        ) : null}

        <TextField
          label="Notes"
          value={form.memo}
          onChangeText={(v) => setField("memo", v)}
          multiline
        />
        </View>
      </Card>

      <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
        <Button
          label={isEdit ? "Save changes" : "Create transaction"}
          onPress={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
          disabled={Boolean(lockMessage?.includes("Reconciled"))}
        />
        {showDeleteInForm ? (
          <Button
            label="Delete transaction"
            variant="danger"
            onPress={() => setDeleteOpen(true)}
            loading={deleteMutation.isPending}
          />
        ) : null}
      </View>

      <ConfirmDialog
        visible={deleteOpen}
        title="Delete transaction"
        message={
          txnQuery.data && isTransferTransaction(txnQuery.data)
            ? "This may delete or unlink both sides of the transfer, depending on account settings."
            : "This transaction will be permanently removed."
        }
        destructive
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
      />

      <OptionsPickerSheet
        visible={picker === "account"}
        title="Account"
        options={accountPickerOptions}
        selectedId={typeof form.account_id === "number" ? String(form.account_id) : null}
        searchPlaceholder="Search accounts"
        onClose={() => setPicker(null)}
        onSelect={(id) => {
          setField("account_id", Number(id));
          if (Number(id) === form.transfer_to_account_id) {
            setField("transfer_to_account_id", "");
          }
        }}
      />

      <OptionsPickerSheet
        visible={picker === "category"}
        title="Category"
        options={categoryPickerOptions}
        selectedId={typeof form.category_id === "number" ? String(form.category_id) : null}
        searchPlaceholder="Search categories"
        onClose={() => setPicker(null)}
        onSelect={(id) => setField("category_id", Number(id))}
      />

      <OptionsPickerSheet
        visible={picker === "transferTo"}
        title={isCreditCardPayment ? "Credit account" : "Transfer to"}
        options={transferDestOptions}
        selectedId={
          typeof form.transfer_to_account_id === "number"
            ? String(form.transfer_to_account_id)
            : null
        }
        searchPlaceholder="Search accounts"
        emptyMessage="No valid destination accounts"
        onClose={() => setPicker(null)}
        onSelect={(id) => setField("transfer_to_account_id", Number(id))}
      />
    </Screen>
  );
}
