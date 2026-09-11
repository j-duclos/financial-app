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
import { formatCurrency, getEffectiveDisplayName, GETTING_STARTED_COPY } from "@budget-app/shared";
import {
  GETTING_STARTED_HOME_ROUTE,
  isOnboardingFutureTransactionMode,
} from "@/features/onboarding/gettingStartedRoutes";
import { categoryPickerOptions as buildCategoryPickerOptions } from "@/features/categories/categoryPickerOptions";
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
import {
  formatMoneyFieldDisplay,
  sanitizeUnsignedMoneyInput,
} from "@/lib/moneyInput";
import {
  TRANSACTION_ENTRY_TYPE_OPTIONS,
  accountFieldLabel,
  applyEntryTypeChange,
  canonicalCreateAmount,
  createTransactionButtonLabel,
  destinationFieldLabel,
  destinationPickerTitle,
  defaultNewTransactionDateIso,
  emptyTransactionForm,
  entryTypeFromExistingTransaction,
  filterDestinationAccounts,
  internalCategoryIdForEntry,
  isTransferLikeEntry,
  onboardingFutureTransactionSaveHandoff,
  payeeOrSourceLabel,
  planNewTransactionSave,
  type DestinationFilterAccount,
  type TransactionEntryType,
  type TransactionFormState,
  transactionFormVisibleFields,
  validateTransactionForm,
} from "./transactionForm";

type PickerKind = "account" | "category" | "transferTo" | null;

function accountHouseholdId(account: Account | undefined): number | undefined {
  if (!account) return undefined;
  const h = account.household as Account["household"] | number | undefined;
  if (typeof h === "object" && h != null && "id" in h) return h.id;
  if (typeof h === "number") return h;
  return undefined;
}

function toDestFilterAccount(account: Account): DestinationFilterAccount {
  return {
    id: account.id,
    account_type: account.account_type,
    householdId: accountHouseholdId(account),
  };
}

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
    source?: string;
    from?: string;
    to?: string;
    amount?: string;
    date?: string;
  }>();
  const editId = params.id ? Number(params.id) : null;
  const isEdit = editId != null && editId > 0;
  const prefillAccount = Number(params.account);
  const transferMode = params.mode === "transfer";
  const futureOnboardingMode = !isEdit && isOnboardingFutureTransactionMode(params);
  const presetFrom = Number(params.from);
  const presetTo = Number(params.to);

  const [form, setForm] = useState<TransactionFormState>(() => {
    const seeded = emptyTransactionForm(
      Number.isInteger(prefillAccount) && prefillAccount > 0 ? prefillAccount : undefined,
      defaultNewTransactionDateIso({
        isOnboardingFuture: isOnboardingFutureTransactionMode(params),
        todayIso: todayStr(),
      })
    );
    return seeded;
  });
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
  const transferLike = isTransferLikeEntry(form.entryType);
  const visible = transactionFormVisibleFields(form.entryType);

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
    if (isEdit || !isTransferLikeEntry(form.entryType) || categories.length === 0) return;
    const nextId = internalCategoryIdForEntry(
      form.entryType,
      bankTransferCategory?.id ?? null,
      creditCardPaymentCategory?.id ?? null
    );
    if (nextId == null) return;
    setForm((prev) => (prev.category_id === nextId ? prev : { ...prev, category_id: nextId }));
  }, [
    isEdit,
    form.entryType,
    categories.length,
    bankTransferCategory,
    creditCardPaymentCategory,
  ]);

  useEffect(() => {
    const txn = txnQuery.data;
    if (!txn) return;
    const abs = Math.abs(parseFloat(txn.amount));
    setForm({
      account_id: txn.account?.id ?? txn.account_id ?? "",
      dateIso: txn.date.slice(0, 10),
      payee: txn.payee,
      amount: Number.isFinite(abs) ? String(abs) : "",
      entryType: entryTypeFromExistingTransaction(txn),
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

  const destFilterAccounts = useMemo(
    () => accounts.map(toDestFilterAccount),
    [accounts]
  );

  const transferDestinations = useMemo((): Account[] => {
    const allowed = new Set(
      filterDestinationAccounts(destFilterAccounts, form.account_id, form.entryType).map((a) => a.id)
    );
    return accounts.filter((a) => allowed.has(a.id));
  }, [accounts, destFilterAccounts, form.account_id, form.entryType]);

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
      buildCategoryPickerOptions(
        categories,
        form.entryType === "income" ? "INCOME" : "EXPENSE",
        false
      ),
    [categories, form.entryType]
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
      const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(form.dateIso)
        ? form.dateIso
        : parseInputDateToIso(form.dateIso);

      if (!isEdit) {
        const plan = planNewTransactionSave({
          form,
          isoDate: isoDate || "",
          destAccountType: selectedDestAccount?.account_type ?? null,
          bankTransferCategoryId: bankTransferCategory?.id ?? null,
          creditCardPaymentCategoryId: creditCardPaymentCategory?.id ?? null,
        });
        if (!plan.ok) {
          setFieldErrors(plan.errors);
          const err = new Error("validation");
          (err as { code?: string }).code = "validation";
          throw err;
        }
        if (plan.api === "createTransfer") {
          return createTransfer(plan.body);
        }
        return createTransaction(plan.body);
      }

      const nextErrors = validateTransactionForm({
        entryType: form.entryType,
        accountId: form.account_id,
        transferToAccountId: form.transfer_to_account_id,
        dateIso: isoDate || "",
        amount: form.amount,
        destAccountType: selectedDestAccount?.account_type ?? null,
      });
      if (Object.keys(nextErrors).length > 0) {
        setFieldErrors(nextErrors);
        const err = new Error("validation");
        (err as { code?: string }).code = "validation";
        throw err;
      }
      if (typeof form.account_id !== "number" || !isoDate) {
        throw new Error("Account and date are required");
      }

      const signedAmount = canonicalCreateAmount(form.entryType, form.amount);

      const body = {
        account_id: form.account_id,
        date: isoDate,
        payee: form.payee.trim() || "—",
        amount: signedAmount,
        category_id: typeof form.category_id === "number" ? form.category_id : null,
        memo: form.memo,
        ...(transferLike && typeof form.transfer_to_account_id === "number"
          ? { transfer_to_account_id: form.transfer_to_account_id }
          : {}),
      };

      if (editId) {
        return updateTransaction(editId, body);
      }
      return createTransaction(body);
    },
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient);
      const isoDate = parseInputDateToIso(form.dateIso) ?? form.dateIso;
      const handoff = onboardingFutureTransactionSaveHandoff({
        isOnboardingFuture: futureOnboardingMode,
        dateIso: isoDate,
        todayIso: todayStr(),
      });
      if (handoff === "home") {
        router.replace(GETTING_STARTED_HOME_ROUTE as never);
        return;
      }
      if (handoff === "saved_not_future") {
        Alert.alert(GETTING_STARTED_COPY.futureTransactionSavedNotFuture);
      }
      router.back();
    },
    onError: (err) => {
      if (err instanceof Error && (err as { code?: string }).code === "validation") return;
      const fields = fieldErrorsFromApiError(err);
      if (Object.keys(fields).length > 0) {
        setFieldErrors(fields);
        return;
      }
      const message = describeApiError(err);
      Alert.alert("Save failed", message);
    },
  });

  const setField = <K extends keyof TransactionFormState>(key: K, value: TransactionFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const onSelectEntryType = (entryType: TransactionEntryType) => {
    setForm((prev) =>
      applyEntryTypeChange({
        prev,
        nextType: entryType,
        destAccountType: selectedDestAccount?.account_type ?? null,
        selectedCategoryName: selectedCategory?.name ?? null,
        bankTransferCategoryId: bankTransferCategory?.id ?? null,
        creditCardPaymentCategoryId: creditCardPaymentCategory?.id ?? null,
      })
    );
    setFieldErrors({});
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
    <View key={type} style={{ flexGrow: 1, flexBasis: "46%" }}>
      <Button
        label={label}
        variant={form.entryType === type ? "primary" : "secondary"}
        onPress={() => onSelectEntryType(type)}
      />
    </View>
  );

  return (
    <Screen scroll>
      <AppHeader title={isEdit ? "Edit transaction" : "Add transaction"} onBack={() => router.back()} />
      {futureOnboardingMode ? (
        <Card testID="onboarding-future-transaction-hint" style={{ marginBottom: theme.spacing.md }}>
          <Text style={{ color: theme.colors.text, ...theme.typography.headline }}>
            {GETTING_STARTED_COPY.futureTransactionFormTitle}
          </Text>
          <Text
            style={{
              color: theme.colors.textSecondary,
              ...theme.typography.caption,
              marginTop: theme.spacing.sm,
            }}
          >
            {GETTING_STARTED_COPY.futureTransactionFormBody}
          </Text>
        </Card>
      ) : null}
      {lockMessage ? (
        <Text style={{ color: theme.colors.warning, ...theme.typography.caption, marginBottom: theme.spacing.md }}>
          {lockMessage}
        </Text>
      ) : null}

      <Card>
        <View style={{ gap: theme.spacing.md }}>
        <SelectField
          label={accountFieldLabel(form.entryType)}
          value={selectedAccount ? getEffectiveDisplayName(selectedAccount) : null}
          placeholder="Select account"
          onPress={() => setPicker("account")}
          error={fieldErrors.account_id}
        />
        {selectedAccount ? (
          <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: -4 }}>
            Current balance{" "}
            {resolvePostedCurrentBalance(selectedAccount)
              ? formatCurrency(resolvePostedCurrentBalance(selectedAccount) as string, selectedAccount.currency ?? "USD")
              : "unavailable"}
          </Text>
        ) : null}

        <DatePickerField
          label="Date"
          value={form.dateIso}
          onChange={(iso) => setField("dateIso", iso)}
        />
        {fieldErrors.dateIso ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{ color: theme.colors.critical, ...theme.typography.caption, marginTop: -8 }}
          >
            {fieldErrors.dateIso}
          </Text>
        ) : null}

        {!isEdit ? (
          <>
            <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginBottom: 8 }}>
              Transaction type
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: theme.spacing.sm }}>
              {TRANSACTION_ENTRY_TYPE_OPTIONS.map((opt) => typeChip(opt.label, opt.type))}
            </View>
          </>
        ) : null}

        <TextField
          label="Amount"
          value={formatMoneyFieldDisplay(form.amount)}
          onChangeText={(v) => setField("amount", sanitizeUnsignedMoneyInput(v))}
          keyboardType="decimal-pad"
          inputMode="decimal"
          autoCorrect={false}
          autoCapitalize="none"
          placeholder="$ 0.00"
          error={fieldErrors.amount}
        />

        {visible.payee || visible.source ? (
          <TextField
            label={payeeOrSourceLabel(form.entryType)}
            value={form.payee}
            onChangeText={(v) => setField("payee", v)}
            error={fieldErrors.payee}
          />
        ) : null}

        {visible.category ? (
          <SelectField
            label="Category"
            value={selectedCategory?.name ?? null}
            placeholder="Select category"
            onPress={() => setPicker("category")}
            error={fieldErrors.category_id}
          />
        ) : null}

        {visible.destination ? (
          <>
            <SelectField
              label={destinationFieldLabel(form.entryType)}
              value={selectedDestAccount ? getEffectiveDisplayName(selectedDestAccount) : null}
              placeholder={form.entryType === "card_payment" ? "Select credit card" : "Select account"}
              onPress={() => setPicker("transferTo")}
              error={fieldErrors.transfer_to_account_id}
            />
            {selectedDestAccount ? (
              <Text style={{ color: theme.colors.textMuted, ...theme.typography.caption, marginTop: -4 }}>
                {balanceSubtitle(selectedDestAccount) ?? "Balance unavailable"}
              </Text>
            ) : null}
            {visible.transferPreview && selectedAccount && form.dateIso ? (
              <TransferSourceBalancePreview
                sourceAccount={selectedAccount}
                destinationAccountId={
                  typeof form.transfer_to_account_id === "number"
                    ? form.transfer_to_account_id
                    : null
                }
                transferDateIso={form.dateIso}
                transferAmount={form.amount}
                excludeTransactionIds={
                  isEdit && editId && txnQuery.data
                    ? [
                        editId,
                        ...(txnQuery.data.linked_transaction_id != null
                          ? [txnQuery.data.linked_transaction_id]
                          : []),
                      ]
                    : []
                }
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
          label={createTransactionButtonLabel(form.entryType, isEdit)}
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
          const nextId = Number(id);
          setForm((prev) => {
            const dests = filterDestinationAccounts(destFilterAccounts, nextId, prev.entryType);
            const destStillValid =
              typeof prev.transfer_to_account_id === "number" &&
              dests.some((d) => d.id === prev.transfer_to_account_id);
            return {
              ...prev,
              account_id: nextId,
              transfer_to_account_id: destStillValid ? prev.transfer_to_account_id : "",
            };
          });
          setFieldErrors((prev) => {
            const next = { ...prev };
            delete next.account_id;
            delete next.transfer_to_account_id;
            return next;
          });
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
        title={destinationPickerTitle(form.entryType)}
        options={transferDestOptions}
        selectedId={
          typeof form.transfer_to_account_id === "number"
            ? String(form.transfer_to_account_id)
            : null
        }
        searchPlaceholder="Search accounts"
        emptyMessage={
          form.entryType === "card_payment"
            ? "No credit cards in this household"
            : "No valid destination accounts"
        }
        onClose={() => setPicker(null)}
        onSelect={(id) => setField("transfer_to_account_id", Number(id))}
      />
    </Screen>
  );
}
