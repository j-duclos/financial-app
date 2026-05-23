import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatAccountOptionLabel, formatCurrency } from "@budget-app/shared";
import type { ReconcileTransactionRow, Transaction } from "@budget-app/shared";
import {
  listAccounts,
  getProfile,
  getReconcileSetup,
  completeReconciliation,
  createTransaction,
  createTransfer,
  getTransaction,
  deleteTransaction,
  listCategories,
  updateTransaction,
} from "@budget-app/api-client";
import { ApiError } from "@budget-app/api-client";

const BALANCE_TOLERANCE = 0.01;
const todayIso = () => new Date().toISOString().slice(0, 10);

/** ISO YYYY-MM-DD → MM-DD-YY for display */
function formatDateMmDdYy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}-${d}-${y.slice(-2)}`;
}

function parseAmount(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function sourceLabel(source: string): string {
  if (source === "PLAID") return "Imported";
  if (source === "RULE" || source === "ONE_TIME") return "Planned";
  if (source === "INTEREST") return "Interest";
  return "Manual";
}

export default function Reconcile() {
  const location = useLocation();
  const navAccountId = (location.state as { accountId?: number } | null)?.accountId;
  const [accountId, setAccountId] = useState<number | "">("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [bankBalanceInput, setBankBalanceInput] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addPayee, setAddPayee] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addCategoryId, setAddCategoryId] = useState<number | "">("");
  const [addTransferToAccountId, setAddTransferToAccountId] = useState<number | "">("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editingTxn, setEditingTxn] = useState<ReconcileTransactionRow | null>(null);
  const [editingFullTxn, setEditingFullTxn] = useState<Transaction | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({
    date: "",
    payee: "",
    amount: "",
    direction: "OUTFLOW" as "INFLOW" | "OUTFLOW",
    category_id: "" as number | "",
    transfer_to_account_id: "" as number | "",
  });
  const [editOriginalAmount, setEditOriginalAmount] = useState(0);
  const [editError, setEditError] = useState<string | null>(null);
  const hasSetInitialAccount = useRef(false);
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: accountsData } = useQuery({ queryKey: ["accounts"], queryFn: () => listAccounts() });
  const accounts = accountsData?.results ?? [];
  const selectedAccount = accounts.find((a) => a.id === accountId);

  useEffect(() => {
    if (hasSetInitialAccount.current) return;
    if (navAccountId != null) {
      setAccountId(navAccountId);
      hasSetInitialAccount.current = true;
      return;
    }
    const defaultId = profile?.default_account;
    if (defaultId != null) {
      setAccountId(Number(defaultId));
      hasSetInitialAccount.current = true;
    }
  }, [profile?.default_account, navAccountId]);

  useEffect(() => {
    setBankBalanceInput("");
    setCheckedIds(new Set());
    setCompleteError(null);
    setPeriodStart("");
    setPeriodEnd("");
  }, [accountId]);

  const { data: metaData, isLoading: metaLoading } = useQuery({
    queryKey: ["reconcile-meta", accountId],
    queryFn: () => getReconcileSetup(accountId as number),
    enabled: !!accountId,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (!metaData || accountId === "") return;
    setPeriodStart(metaData.min_start_date);
    setPeriodEnd((prev) => {
      if (!prev || prev < metaData.min_start_date) return metaData.max_end_date;
      return prev;
    });
  }, [metaData?.min_start_date, metaData?.max_end_date, accountId]);

  const minStartDate = metaData?.min_start_date ?? null;
  const maxEndDate = metaData?.max_end_date ?? todayIso();
  const periodDatesValid =
    !!periodStart &&
    !!periodEnd &&
    (!minStartDate || periodStart >= minStartDate) &&
    periodEnd <= maxEndDate &&
    periodStart <= periodEnd;

  const {
    data: setupData,
    isLoading: setupLoading,
    isSuccess: setupSuccess,
    error: setupError,
  } = useQuery({
    queryKey: ["reconcile-setup", accountId, periodStart, periodEnd],
    queryFn: () =>
      getReconcileSetup(accountId as number, {
        start: periodStart,
        end: periodEnd,
      }),
    enabled: !!accountId && periodDatesValid,
    staleTime: 0,
    gcTime: 0,
  });

  useEffect(() => {
    if (!setupSuccess || !setupData?.period_start_date) return;
    if (setupData.period_start_date !== periodStart) {
      setPeriodStart(setupData.period_start_date);
    }
  }, [setupSuccess, setupData?.period_start_date, periodStart]);

  useEffect(() => {
    setCheckedIds(new Set());
    setCompleteError(null);
    setShowAddForm(false);
    setAddError(null);
    if (periodEnd) setAddDate(periodEnd);
  }, [periodStart, periodEnd]);

  const isFirstReconciliation = metaData?.is_first_reconciliation ?? true;
  const lastReconcilePeriodEnd = metaData?.last_reconcile_period_end ?? null;

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "reconcile", selectedAccount?.household?.id],
    queryFn: () =>
      listCategories({
        page_size: 500,
        ...(selectedAccount?.household?.id ? { household: selectedAccount.household.id } : {}),
      }),
    enabled: !!selectedAccount?.household?.id,
  });
  const categories = categoriesData?.results ?? [];
  const categoriesForDropdown = useMemo(() => {
    return [...categories].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    );
  }, [categories]);

  const addSelectedCategory = useMemo(
    () => (addCategoryId ? categories.find((c) => c.id === addCategoryId) : null),
    [categories, addCategoryId],
  );
  const addIsTransferCategory =
    addSelectedCategory?.name === "Transfer" ||
    addSelectedCategory?.name === "Bank Transfer" ||
    addSelectedCategory?.name === "Credit Card Payment";
  const addTransferToAccounts = useMemo(() => {
    if (!selectedAccount || !accountId) return [];
    const sameHousehold = selectedAccount.household?.id;
    return accounts.filter(
      (a) =>
        a.id !== accountId &&
        a.household?.id === sameHousehold &&
        (addSelectedCategory?.name === "Credit Card Payment" ? a.account_type === "CREDIT" : true),
    );
  }, [selectedAccount, accountId, accounts, addSelectedCategory?.name]);

  const editCategory = useMemo(
    () => (editForm.category_id ? categories.find((c) => c.id === editForm.category_id) : null),
    [categories, editForm.category_id],
  );
  const editIsTransferCategoryName = (name: string | undefined) =>
    name === "Transfer" || name === "Bank Transfer" || name === "Credit Card Payment";
  const editIsLinkedTransfer = Boolean(editingFullTxn?.transfer_to_account);
  const editIsCreditCardInflow =
    selectedAccount != null &&
    String(selectedAccount.account_type ?? "").toUpperCase() === "CREDIT" &&
    editForm.direction === "INFLOW";
  const hideEditTransferToSelector =
    editIsCreditCardInflow &&
    (editIsLinkedTransfer || editIsTransferCategoryName(editCategory?.name));
  const editTransferCounterparty = editingFullTxn?.transfer_to_account ?? null;
  const editTransferToAccounts = useMemo(() => {
    if (!selectedAccount || !accountId) return [];
    const sameHousehold = selectedAccount.household?.id;
    const creditOnly = editCategory?.name === "Credit Card Payment";
    return accounts.filter(
      (a) =>
        a.id !== accountId &&
        a.household?.id === sameHousehold &&
        (creditOnly ? a.account_type === "CREDIT" : true),
    );
  }, [selectedAccount, accountId, accounts, editCategory?.name]);
  const showEditTransferToSelector =
    Boolean(editingFullTxn) &&
    editTransferToAccounts.length > 0 &&
    (editIsLinkedTransfer || editIsTransferCategoryName(editCategory?.name)) &&
    !hideEditTransferToSelector;
  const editDestinationAccount = useMemo(
    () =>
      editForm.transfer_to_account_id
        ? editTransferToAccounts.find((a) => a.id === editForm.transfer_to_account_id)
        : null,
    [editForm.transfer_to_account_id, editTransferToAccounts],
  );
  const editDirectionIsPaymentLike =
    editCategory?.name === "Credit Card Payment" ||
    (editIsLinkedTransfer &&
      editDestinationAccount != null &&
      String(editDestinationAccount.account_type ?? "").toUpperCase() === "CREDIT");

  async function invalidateReconcileQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reconcile-meta"] }),
      queryClient.invalidateQueries({ queryKey: ["reconcile-setup"] }),
      queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["timeline"] }),
      queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    ]);
  }

  const periodOpeningBalance = parseAmount(
    setupData?.period_opening_balance ?? setupData?.last_reconciled_balance ?? "0",
  );
  const appPeriodEndBalance = parseAmount(setupData?.app_current_balance ?? "0");
  const bankPeriodEndBalance = bankBalanceInput.trim() === "" ? null : parseAmount(bankBalanceInput);
  const setupDifference =
    bankPeriodEndBalance != null ? bankPeriodEndBalance - appPeriodEndBalance : null;

  const transactions: ReconcileTransactionRow[] = setupSuccess
    ? setupData?.unreconciled_transactions ?? []
    : [];

  const checkedSum = useMemo(() => {
    let sum = 0;
    for (const t of transactions) {
      if (checkedIds.has(t.id)) sum += parseAmount(t.amount);
    }
    return sum;
  }, [transactions, checkedIds]);

  const offBy =
    bankPeriodEndBalance != null ? bankPeriodEndBalance - (periodOpeningBalance + checkedSum) : null;
  const isBalanced =
    offBy != null && Math.abs(offBy) <= BALANCE_TOLERANCE;

  const canComplete =
    !!accountId &&
    !!periodStart &&
    !!periodEnd &&
    bankPeriodEndBalance != null &&
    bankBalanceInput.trim() !== "" &&
    isBalanced;

  function resetAddForm() {
    setAddPayee("");
    setAddAmount("");
    setAddCategoryId("");
    setAddTransferToAccountId("");
    setShowAddForm(false);
  }

  async function onAddSuccess(txnId: number) {
    setAddError(null);
    resetAddForm();
    await invalidateReconcileQueries();
    setCheckedIds((prev) => new Set(prev).add(txnId));
  }

  const addMu = useMutation({
    mutationFn: createTransaction,
    onSuccess: async (txn) => {
      await onAddSuccess(txn.id);
    },
    onError: (err: unknown) => {
      setAddError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  const addTransferMu = useMutation({
    mutationFn: createTransfer,
    onSuccess: async (data, variables) => {
      const bankLegId =
        variables.from_account === accountId ? data.from_transaction.id : data.to_transaction.id;
      await onAddSuccess(bankLegId);
    },
    onError: (err: unknown) => {
      setAddError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  function submitAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    if (!accountId || !periodStart || !periodEnd) return;
    const date = addDate || periodEnd;
    if (date < periodStart || date > periodEnd) {
      setAddError(`Date must be within ${formatDateMmDdYy(periodStart)} – ${formatDateMmDdYy(periodEnd)}.`);
      return;
    }
    const signedAmt = parseFloat(addAmount);
    if (!addPayee.trim()) {
      setAddError("Payee is required.");
      return;
    }
    if (!addAmount.trim() || signedAmt === 0 || Number.isNaN(signedAmt)) {
      setAddError("Enter a non-zero amount.");
      return;
    }
    if (addIsTransferCategory && !addTransferToAccountId) {
      setAddError(
        addSelectedCategory?.name === "Credit Card Payment"
          ? "Select the credit card being paid."
          : "Select the transfer destination account.",
      );
      return;
    }

    if (addIsTransferCategory && addTransferToAccountId) {
      const absAmt = Math.abs(signedAmt);
      const isOutflow = signedAmt < 0;
      addTransferMu.mutate({
        from_account: (isOutflow ? accountId : addTransferToAccountId) as number,
        to_account: (isOutflow ? addTransferToAccountId : accountId) as number,
        amount: String(absAmt),
        date,
        payee: addPayee.trim(),
        from_category_id: addCategoryId === "" ? undefined : addCategoryId,
      });
      return;
    }

    addMu.mutate({
      account_id: accountId as number,
      date,
      payee: addPayee.trim(),
      amount: String(signedAmt),
      category_id: addCategoryId === "" ? null : addCategoryId,
      cleared: true,
    });
  }

  const updateMu = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: {
        date: string;
        payee: string;
        amount: string;
        category_id: number | null;
        transfer_to_account_id?: number;
      };
    }) => updateTransaction(id, data),
    onSuccess: async () => {
      setEditError(null);
      setEditingTxn(null);
      setEditingFullTxn(null);
      await invalidateReconcileQueries();
    },
    onError: (err: unknown) => {
      setEditError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  const deleteMu = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: async (_data, deletedId) => {
      setEditError(null);
      setEditingTxn(null);
      setEditingFullTxn(null);
      setCheckedIds((prev) => {
        const next = new Set(prev);
        next.delete(deletedId);
        return next;
      });
      await invalidateReconcileQueries();
    },
    onError: (err: unknown) => {
      setEditError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  async function openEdit(t: ReconcileTransactionRow) {
    setEditError(null);
    setEditingTxn(t);
    setEditingFullTxn(null);
    setEditLoading(true);
    try {
      const txn = await getTransaction(t.id);
      setEditingFullTxn(txn);
      const amt = parseFloat(txn.amount);
      const transferTo = txn.transfer_to_account;
      const transferToId = transferTo?.id ?? "";
      const cardName = transferTo?.name ?? "";
      const basePayee = (txn.payee || "").trim().replace(/\s*\([^)]+\)(?:\s*\([^)]+\))*\s*$/g, "").trim();
      const payeeWithCard =
        cardName && basePayee ? `${basePayee} (${cardName})` : basePayee || cardName;
      setEditOriginalAmount(amt);
      setEditForm({
        date: txn.date,
        payee: payeeWithCard,
        amount: String(Math.abs(amt)),
        direction: amt >= 0 ? "INFLOW" : "OUTFLOW",
        category_id: (txn.category?.id ?? txn.category_id) ?? "",
        transfer_to_account_id: transferToId,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setEditError(msg || "Could not load transaction for edit");
      setEditingTxn(null);
    } finally {
      setEditLoading(false);
    }
  }

  function closeEdit() {
    setEditingTxn(null);
    setEditingFullTxn(null);
    setEditError(null);
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTxn || !editingFullTxn) return;
    setEditError(null);
    const absAmt = parseAmount(editForm.amount);
    if (!editForm.payee.trim()) {
      setEditError("Payee is required.");
      return;
    }
    if (absAmt === 0) {
      setEditError("Enter a non-zero amount.");
      return;
    }
    const origSign = editOriginalAmount < 0 ? -1 : editOriginalAmount > 0 ? 1 : 0;
    const dirOutflow = editForm.direction === "OUTFLOW";
    const signedAmount =
      origSign === 0
        ? dirOutflow
          ? -absAmt
          : absAmt
        : origSign < 0 === dirOutflow
          ? origSign * absAmt
          : dirOutflow
            ? -absAmt
            : absAmt;
    const transferCategory = editIsTransferCategoryName(editCategory?.name);
    const omitTransferToOnSubmit = hideEditTransferToSelector;
    if (
      showEditTransferToSelector &&
      !omitTransferToOnSubmit &&
      !editForm.transfer_to_account_id &&
      (editIsLinkedTransfer || transferCategory)
    ) {
      setEditError(
        editCategory?.name === "Credit Card Payment"
          ? "Select the credit card being paid."
          : "Select the transfer destination account.",
      );
      return;
    }
    const payload: {
      date: string;
      payee: string;
      amount: string;
      category_id: number | null;
      transfer_to_account_id?: number;
    } = {
      date: editForm.date,
      payee: editForm.payee.trim() || "—",
      amount: String(signedAmount),
      category_id: editForm.category_id === "" ? null : editForm.category_id,
    };
    if (
      !omitTransferToOnSubmit &&
      editForm.transfer_to_account_id &&
      (editIsLinkedTransfer || transferCategory)
    ) {
      payload.transfer_to_account_id = editForm.transfer_to_account_id as number;
    }
    updateMu.mutate({ id: editingTxn.id, data: payload });
  }

  function handleDeleteEdit() {
    if (!editingTxn) return;
    const counterparty = editingFullTxn?.transfer_to_account?.name;
    const msg =
      editIsLinkedTransfer && counterparty
        ? `Delete this transaction and its linked entry on ${counterparty}? Both legs will be removed.`
        : `Delete ${editForm.payee || editingTxn.payee}?`;
    if (window.confirm(msg)) {
      deleteMu.mutate(editingTxn.id);
    }
  }

  const completeMu = useMutation({
    mutationFn: () =>
      completeReconciliation({
        account_id: accountId as number,
        bank_current_balance: bankBalanceInput.trim(),
        checked_transaction_ids: Array.from(checkedIds),
        period_start_date: periodStart,
        period_end_date: periodEnd,
      }),
    onSuccess: async () => {
      setCompleteError(null);
      setCheckedIds(new Set());
      setBankBalanceInput("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reconcile-meta"] }),
        queryClient.invalidateQueries({ queryKey: ["reconcile-setup"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["timeline"] }),
      ]);
      const meta = await queryClient.fetchQuery({
        queryKey: ["reconcile-meta", accountId],
        queryFn: () => getReconcileSetup(accountId as number),
      });
      setPeriodStart(meta.min_start_date);
      setPeriodEnd(meta.max_end_date);
    },
    onError: (err: unknown) => {
      setCompleteError(err instanceof ApiError ? err.message : (err as Error).message);
    },
  });

  function toggleChecked(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (checkedIds.size === transactions.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(transactions.map((t) => t.id)));
    }
  }

  const showChecklist =
    !!accountId && setupSuccess && setupData != null && periodDatesValid;
  const showPeriodTools = !!accountId && periodDatesValid && !!periodStart && !!periodEnd;
  const periodLabel =
    periodStart && periodEnd
      ? `${formatDateMmDdYy(periodStart)} — ${formatDateMmDdYy(periodEnd)}`
      : "";

  return (
    <div className="p-4 max-w-6xl mx-auto pb-36">
      <h1 className="text-xl font-semibold mb-2">Reconcile</h1>
      <p className="text-sm text-gray-600 mb-6">
        Reconcile in date-range chunks. Start from your last reconcile (or opening balance), pick an end date,
        and match transactions against your bank statement for that period.
      </p>

      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
        <h2 className="text-sm font-medium text-gray-800 mb-4">Reconcile setup</h2>
        <div className="flex flex-wrap gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Account</label>
            <select
              value={accountId === "" ? "" : String(accountId)}
              onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm min-w-[200px]"
            >
              <option value="">Select account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountOptionLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Period start</label>
            <input
              type="date"
              value={periodStart}
              min={minStartDate ?? undefined}
              max={periodEnd || maxEndDate}
              disabled={!accountId || metaLoading}
              onChange={(e) => {
                const v = e.target.value;
                if (minStartDate && v && v < minStartDate) {
                  setPeriodStart(minStartDate);
                } else {
                  setPeriodStart(v);
                }
              }}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50"
            />
            {minStartDate && (
              <p className="text-xs text-gray-500 mt-0.5">
                {isFirstReconciliation
                  ? `Earliest: ${formatDateMmDdYy(minStartDate)} (opening balance)`
                  : `Earliest: ${formatDateMmDdYy(minStartDate)} (after reconcile through ${formatDateMmDdYy(lastReconcilePeriodEnd)})`}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Period end</label>
            <input
              type="date"
              value={periodEnd}
              min={periodStart || minStartDate || undefined}
              max={maxEndDate}
              disabled={!accountId || metaLoading}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:bg-gray-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Bank balance as of period end
            </label>
            <input
              type="number"
              step="0.01"
              value={bankBalanceInput}
              onChange={(e) => setBankBalanceInput(e.target.value)}
              placeholder="0.00"
              disabled={!accountId || !periodEnd}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm w-40 disabled:bg-gray-50"
            />
          </div>
        </div>

        {accountId && (metaLoading || setupLoading) && (
          <p className="text-sm text-gray-500">Loading account balances…</p>
        )}
        {setupError && (
          <p className="text-sm text-red-600">{(setupError as Error).message}</p>
        )}

        {accountId && setupData && periodStart && periodEnd && setupSuccess && (
          <div className="grid sm:grid-cols-3 gap-4 mt-2">
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
              <p className="text-xs font-medium text-gray-500 mb-1">
                App balance ({formatDateMmDdYy(periodEnd)})
              </p>
              <p className="text-lg font-semibold tabular-nums">{formatCurrency(appPeriodEndBalance)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
              <p className="text-xs font-medium text-gray-500 mb-1">
                Bank balance ({formatDateMmDdYy(periodEnd)})
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {bankPeriodEndBalance != null ? formatCurrency(bankPeriodEndBalance) : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
              <p className="text-xs font-medium text-gray-500 mb-1">Difference</p>
              <p
                className={`text-lg font-semibold tabular-nums ${
                  setupDifference != null && Math.abs(setupDifference) > BALANCE_TOLERANCE
                    ? "text-amber-700"
                    : "text-gray-900"
                }`}
              >
                {setupDifference != null ? formatCurrency(setupDifference) : "—"}
              </p>
            </div>
          </div>
        )}
      </div>

      {showChecklist && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-6">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-800">Unreconciled transactions</h2>
            <span className="text-xs text-gray-500">
              {transactions.length} in {periodLabel}
            </span>
          </div>
          {transactions.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">
              No unreconciled transactions in this date range.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left w-10">
                      <input
                        type="checkbox"
                        checked={checkedIds.size === transactions.length && transactions.length > 0}
                        onChange={toggleAll}
                        aria-label="Select all transactions"
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Payee</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Category</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Balance</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Source</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 w-16">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map((t) => {
                    const amt = parseAmount(t.amount);
                    return (
                      <tr key={t.id} className={checkedIds.has(t.id) ? "bg-blue-50/50" : "hover:bg-gray-50"}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checkedIds.has(t.id)}
                            onChange={() => toggleChecked(t.id)}
                            aria-label={`Select ${t.payee}`}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDateMmDdYy(t.date)}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium text-gray-900">{t.payee}</span>
                          {t.memo ? <span className="block text-xs text-gray-500">{t.memo}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{t.category ?? "—"}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums font-medium ${
                            amt >= 0 ? "text-green-700" : "text-red-700"
                          }`}
                        >
                          {formatCurrency(amt)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {t.running_balance != null ? formatCurrency(parseAmount(t.running_balance)) : "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{sourceLabel(t.source)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => openEdit(t)}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showPeriodTools && (
        <div className="bg-white border border-gray-200 rounded-lg mb-6 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-gray-800">Missing from your ledger?</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Add a bank statement line here instead of leaving Reconcile.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowAddForm((v) => !v);
                setAddError(null);
                if (!addDate) setAddDate(periodEnd);
              }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium shrink-0"
            >
              {showAddForm ? "Cancel" : "+ Add transaction"}
            </button>
          </div>
          {showAddForm && (
            <form onSubmit={submitAddTransaction} className="p-4 flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  value={addDate || periodEnd}
                  min={periodStart}
                  max={periodEnd}
                  onChange={(e) => setAddDate(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  required
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Payee</label>
                <input
                  type="text"
                  value={addPayee}
                  onChange={(e) => setAddPayee(e.target.value)}
                  placeholder="Payee"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  required
                />
              </div>
              <div className="min-w-[160px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select
                  value={addCategoryId === "" ? "" : String(addCategoryId)}
                  onChange={(e) => {
                    setAddCategoryId(e.target.value === "" ? "" : Number(e.target.value));
                    setAddTransferToAccountId("");
                  }}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {categoriesForDropdown.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {addIsTransferCategory && (
                  <select
                    value={addTransferToAccountId === "" ? "" : String(addTransferToAccountId)}
                    onChange={(e) =>
                      setAddTransferToAccountId(e.target.value === "" ? "" : Number(e.target.value))
                    }
                    className="w-full mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">
                      {addSelectedCategory?.name === "Credit Card Payment"
                        ? "Select credit card"
                        : "Select bank account"}
                    </option>
                    {addTransferToAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  value={addAmount}
                  onChange={(e) => setAddAmount(e.target.value)}
                  placeholder="- for debit, no sign for credit"
                  title="Amount (negative = expense, positive = income)"
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm w-36 text-right"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={
                  addMu.isPending ||
                  addTransferMu.isPending ||
                  (addIsTransferCategory && !addTransferToAccountId)
                }
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {addMu.isPending || addTransferMu.isPending ? "Adding…" : "Add & check"}
              </button>
              {addError && <p className="w-full text-sm text-red-600">{addError}</p>}
            </form>
          )}
        </div>
      )}

      {showChecklist && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="grid md:grid-cols-2 gap-6 mb-4">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">
                  {isFirstReconciliation ? "Opening balance" : "Period opening balance"} (
                  {formatDateMmDdYy(periodStart)})
                </p>
                <p className="text-xl font-semibold tabular-nums">{formatCurrency(periodOpeningBalance)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Bank balance as of {formatDateMmDdYy(periodEnd)}:{" "}
                  <span className="font-medium text-gray-700">
                    {bankPeriodEndBalance != null ? formatCurrency(bankPeriodEndBalance) : "—"}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Off by</p>
                {offBy != null ? (
                  <p
                    className={`text-2xl font-semibold tabular-nums ${
                      isBalanced ? "text-green-700" : "text-amber-700"
                    }`}
                  >
                    {formatCurrency(offBy)}
                  </p>
                ) : (
                  <p className="text-2xl font-semibold tabular-nums text-gray-400">—</p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  {offBy == null
                    ? "Enter bank balance to begin."
                    : isBalanced
                      ? "Matched — ready to complete."
                      : "Check transactions until this reaches $0.00."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                {completeError && <p className="text-sm text-red-600">{completeError}</p>}
                {completeMu.isSuccess && (
                  <p className="text-sm text-green-700">Reconciliation saved for {periodLabel}.</p>
                )}
              </div>
              <button
                type="button"
                disabled={!canComplete || completeMu.isPending}
                onClick={() => completeMu.mutate()}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {completeMu.isPending ? "Saving…" : "Complete Reconciliation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTxn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-30 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <h2 className="text-lg font-semibold mb-1">Edit transaction</h2>
            <p className="text-xs text-gray-500 mb-4">
              Changes save to your ledger and appear on Transactions.
              {editIsLinkedTransfer && editTransferCounterparty?.name
                ? ` Linked entries on ${editTransferCounterparty.name} are updated or removed together.`
                : ""}
            </p>
            {editError && (
              <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {editError}
              </p>
            )}
            {editLoading ? (
              <p className="text-sm text-gray-500">Loading transaction…</p>
            ) : (
            <form onSubmit={submitEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Date</label>
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Payee</label>
                <input
                  type="text"
                  value={editForm.payee}
                  onChange={(e) => setEditForm((f) => ({ ...f, payee: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  required
                />
                  {showEditTransferToSelector && editForm.transfer_to_account_id && editDestinationAccount && (
                    <p className="mt-1 text-xs text-gray-500">
                      {editCategory?.name === "Credit Card Payment" ||
                      String(editDestinationAccount.account_type ?? "").toUpperCase() === "CREDIT" ? (
                        <>
                          Payment into: <strong>{editDestinationAccount.name}</strong>
                        </>
                      ) : (
                        <>
                          Transfers to: <strong>{editDestinationAccount.name}</strong>
                        </>
                      )}
                    </p>
                  )}
                  {hideEditTransferToSelector && editTransferCounterparty?.name && (
                    <p className="mt-1 text-xs text-gray-500">
                      Paid from: <strong>{editTransferCounterparty.name}</strong>
                      {editCategory?.name === "Credit Card Payment"
                        ? " (edit that payment on the paying account to change the bank side)."
                        : ""}
                    </p>
                  )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Category</label>
                <select
                  value={editForm.category_id === "" ? "" : String(editForm.category_id)}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      category_id: e.target.value === "" ? "" : Number(e.target.value),
                      transfer_to_account_id: "",
                    }))
                  }
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">None</option>
                  {categoriesForDropdown.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {showEditTransferToSelector && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    {editCategory?.name === "Credit Card Payment"
                      ? "Payment to (credit card)"
                      : "Transfer to account"}
                  </label>
                  <select
                    value={editForm.transfer_to_account_id === "" ? "" : String(editForm.transfer_to_account_id)}
                    onChange={(e) => {
                      const newId = e.target.value === "" ? "" : Number(e.target.value);
                      const picked = editTransferToAccounts.find((a) => a.id === newId);
                      const pickedName = picked?.name ?? "";
                      setEditForm((f) => {
                        const base = (f.payee || "")
                          .replace(/\s*\([^)]+\)(?:\s*\([^)]+\))*\s*$/g, "")
                          .trim();
                        return {
                          ...f,
                          transfer_to_account_id: newId,
                          payee: base ? (pickedName ? `${base} (${pickedName})` : base) : pickedName,
                        };
                      });
                    }}
                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    required={editIsLinkedTransfer || editIsTransferCategoryName(editCategory?.name)}
                  >
                    <option value="">
                      {editCategory?.name === "Credit Card Payment"
                        ? "Select credit card"
                        : "Select account"}
                    </option>
                    {editTransferToAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Direction</label>
                <select
                  value={editForm.direction}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, direction: e.target.value as "INFLOW" | "OUTFLOW" }))
                  }
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                >
                  {editDirectionIsPaymentLike ? (
                    <>
                      <option value="OUTFLOW">Out (payment)</option>
                      <option value="INFLOW">In (payment)</option>
                    </>
                  ) : (
                    <>
                      <option value="OUTFLOW">Out (expense)</option>
                      <option value="INFLOW">In (income)</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.amount}
                  onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleDeleteEdit}
                  disabled={deleteMu.isPending || updateMu.isPending}
                  className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                >
                  {deleteMu.isPending ? "Deleting…" : "Delete"}
                </button>
                <div className="flex gap-2">
                <button
                  type="button"
                  onClick={closeEdit}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMu.isPending || deleteMu.isPending}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateMu.isPending ? "Saving…" : "Save changes"}
                </button>
                </div>
              </div>
            </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
