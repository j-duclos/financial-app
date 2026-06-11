import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatAccountOptionLabel } from "@budget-app/shared";
import type { Transaction } from "@budget-app/shared";
import {
  listTransactions,
  listAccounts,
  listCategories,
  createTransaction,
  createTransfer,
  updateTransaction,
  updateRule,
  deleteTransaction,
  cleanupOrphanedRuleRows,
  getProfile,
  getAccount,
  getTimeline,
  getTransaction,
  getAccountPayoff,
  ApiError,
  type PayoffProjection,
} from "@budget-app/api-client";
import { PlaidConnectBar } from "../components/PlaidConnectBar";
import ForecastSummaryBar from "../components/transactions/ForecastSummaryBar";
import PastSection from "../components/transactions/PastSection";
import ForecastCardsSection from "../components/transactions/ForecastCardsSection";
import InlineAddRow from "../components/transactions/InlineAddRow";
import MaintenanceMenu from "../components/transactions/MaintenanceMenu";
import TransactionsFilterBar from "../components/transactions/TransactionsFilterBar";
import {
  filterLedgerPastRows,
  hasActiveLedgerRowFilters,
  parseAmountFilterInput,
} from "../components/transactions/ledgerRowFilters";
import type { TransactionKind } from "../components/transactions/transactionKindUtils";
import {
  todayStr,
  formatDateDisplay,
  addMonths,
  creditOwedAsOfDateFromTimeline,
  assetBalanceAsOfDateFromTimeline,
  buildLedgerRows,
  buildLedgerRowsFromTimeline,
  splitLedgerSections,
  timelineHasAccountRows,
  isTransferCategoryName,
  accountLedgerDisplayBalance,
  timelineRangeForFilter,
  projectionTimelineRangeForAsOf,
  type TimeFilter,
} from "../components/transactions/transactionsLedgerUtils";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
import { accountLifecycleStatus } from "../lib/accountOrganization";
import { patchTimelineCachesForTransaction, refreshAfterTransactionEdit, scheduleTimelineRefresh, type TimelinePatchScope } from "../lib/financialQueryRefresh";
import {
  loadStoredTransactionsAccountId,
  loadStoredTransactionsTimeFilter,
  saveStoredTransactionsAccountId,
  saveStoredTransactionsTimeFilter,
  loadStoredTransactionsKindFilter,
  saveStoredTransactionsKindFilter,
  loadStoredTransactionsAmountMin,
  loadStoredTransactionsAmountMax,
  saveStoredTransactionsAmountRange,
  loadStoredTransactionsReconciledFilter,
  saveStoredTransactionsReconciledFilter,
} from "../lib/transactionsPageState";

export type { TimeFilter };

type TransactionsLocationState = {
  accountId?: number;
  focus?: string;
  focusPlaid?: boolean;
  prefillDate?: string;
  prefillPayee?: string;
  prefillAmount?: string;
  fromBillChecklist?: boolean;
};

export default function Transactions() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navState = (location.state as TransactionsLocationState | null) ?? null;
  const isPlaidOAuthReturn = searchParams.has("oauth_state_id") || navState?.focusPlaid === true;
  const [accountId, setAccountId] = useState<number | "">(() => loadStoredTransactionsAccountId());
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => loadStoredTransactionsTimeFilter());
  const [kindFilter, setKindFilter] = useState<TransactionKind | "">(() => loadStoredTransactionsKindFilter());
  const [reconciledFilter, setReconciledFilter] = useState(() => loadStoredTransactionsReconciledFilter());
  const [amountMinInput, setAmountMinInput] = useState(() => loadStoredTransactionsAmountMin());
  const [amountMaxInput, setAmountMaxInput] = useState(() => loadStoredTransactionsAmountMax());
  const hasSetInitialAccount = useRef(false);
  const hasAppliedBillPrefill = useRef(false);

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });

  const [inlineRow, setInlineRow] = useState({
    date: todayStr(),
    payee: "",
    category_id: "" as number | "",
    transfer_to_account_id: "" as number | "",
    amount: "",
    direction: "OUTFLOW" as "INFLOW" | "OUTFLOW",
  });
  const [editing, setEditing] = useState<Transaction | null>(null);
  /** When editing a transaction that came from a rule, we offer "this only" vs "all future". */
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [applyToRule, setApplyToRule] = useState(false);
  const [payoffPayment, setPayoffPayment] = useState("");
  const [payoffResult, setPayoffResult] = useState<PayoffProjection | null>(null);
  const [payoffError, setPayoffError] = useState<string | null>(null);
  const [payoffLoading, setPayoffLoading] = useState(false);
  const [pastExpanded, setPastExpanded] = useState(true);
  const [forecastExpanded, setForecastExpanded] = useState(false);
  const [forecastSummaryExpanded, setForecastSummaryExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [orphanCleanupMessage, setOrphanCleanupMessage] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    date: todayStr(),
    payee: "",
    category_id: "" as number | "",
    account_id: "" as number | "",
    amount: "",
    direction: "OUTFLOW" as "INFLOW" | "OUTFLOW",
    transfer_to_account_id: "" as number | "",
  });
  const debouncedInlineDate = useDebouncedValue(inlineRow.date, 450);
  const debouncedEditDate = useDebouncedValue(editForm.date, 450);
  const debouncedAmountMinInput = useDebouncedValue(amountMinInput, 350);
  const debouncedAmountMaxInput = useDebouncedValue(amountMaxInput, 350);
  const queryClient = useQueryClient();

  const { start: timelineStart, end: timelineEnd } = useMemo(
    () => timelineRangeForFilter(timeFilter),
    [timeFilter]
  );

  const { data: txnsData } = useQuery({
    queryKey: [
      "transactions",
      { account: accountId || undefined, date_after: timelineStart, date_before: timelineEnd },
    ],
    queryFn: () =>
      listTransactions({
        ...(accountId
          ? {
              account: accountId as number,
              date_after: timelineStart,
              date_before: timelineEnd,
              page_size: 2000,
            }
          : {}),
      }),
    enabled: !!accountId && !!timelineStart && !!timelineEnd,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const {
    data: timelineData,
    isFetching: timelineFetching,
    isError: timelineError,
  } = useQuery({
    queryKey: ["timeline", timelineStart, timelineEnd, accountId, todayStr()],
    queryFn: () =>
      getTimeline({
        start: timelineStart,
        end: timelineEnd,
        as_of: todayStr(),
        account_id: typeof accountId === "number" ? accountId : undefined,
      }),
    enabled: typeof accountId === "number",
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const { data: accountData } = useQuery({
    queryKey: ["account", accountId, "ledger"],
    queryFn: () => getAccount(accountId as number, true),
    enabled: !!accountId,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const { data: accountForecastData } = useQuery({
    queryKey: ["account", accountId, "forecast", "health"],
    queryFn: () =>
      getAccount(accountId as number, true, { forecast_summary: true, health: true, days: 30 }),
    enabled: !!accountId && !!accountData,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "transactions-picker"],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "transactions", accountData?.household?.id ?? "all"],
    queryFn: () =>
      listCategories({
        page_size: 500,
        ...(accountData?.household?.id ? { household: accountData.household.id } : {}),
      }),
    enabled: !!accountId,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const transactions = txnsData?.results ?? [];
  const account = useMemo(() => {
    if (!accountData) return accountForecastData;
    if (!accountForecastData) return accountData;
    return { ...accountData, ...accountForecastData };
  }, [accountData, accountForecastData]);

  const [loadHouseholdWarnings, setLoadHouseholdWarnings] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLoadHouseholdWarnings(true), 3000);
    return () => window.clearTimeout(t);
  }, []);
  const accounts = useMemo(() => {
    const rows = accountsData?.results ?? [];
    return rows.filter((a) => accountLifecycleStatus(a) === "active");
  }, [accountsData?.results]);

  useEffect(() => {
    saveStoredTransactionsAccountId(accountId);
  }, [accountId]);

  useEffect(() => {
    saveStoredTransactionsTimeFilter(timeFilter);
  }, [timeFilter]);

  useEffect(() => {
    saveStoredTransactionsKindFilter(kindFilter);
  }, [kindFilter]);

  useEffect(() => {
    saveStoredTransactionsReconciledFilter(reconciledFilter);
  }, [reconciledFilter]);

  useEffect(() => {
    saveStoredTransactionsAmountRange(amountMinInput, amountMaxInput);
  }, [amountMinInput, amountMaxInput]);

  useEffect(() => {
    if (accountId !== "" && !accounts.some((a) => a.id === accountId)) {
      setAccountId("");
      hasSetInitialAccount.current = false;
    }
  }, [accountId, accounts]);

  useEffect(() => {
    if (accounts.length === 0) return;
    if (navState?.accountId != null) {
      const navId = Number(navState.accountId);
      if (accounts.some((a) => a.id === navId)) {
        setAccountId(navId);
        hasSetInitialAccount.current = true;
        if (navState.focus === "view_upcoming") {
          setForecastExpanded(true);
          setPastExpanded(false);
        }
      }
      return;
    }
    if (hasSetInitialAccount.current) return;
    if (typeof accountId === "number" && accounts.some((a) => a.id === accountId)) {
      hasSetInitialAccount.current = true;
      return;
    }
    const defaultId = profile?.default_account;
    const defaultActive =
      defaultId != null && accounts.some((a) => a.id === Number(defaultId))
        ? Number(defaultId)
        : null;
    setAccountId(defaultActive ?? accounts[0].id);
    hasSetInitialAccount.current = true;
  }, [profile?.default_account, navState?.accountId, navState?.focus, accounts, accountId]);

  useEffect(() => {
    if (hasAppliedBillPrefill.current || accountId === "") return;
    if (!navState?.prefillDate && !navState?.prefillPayee) return;
    const amtRaw = navState.prefillAmount ? parseFloat(navState.prefillAmount) : NaN;
    const outflowAmt = Number.isFinite(amtRaw) ? String(-Math.abs(amtRaw)) : "";
    setInlineRow((row) => ({
      ...row,
      date: navState.prefillDate ?? row.date,
      payee: navState.prefillPayee ?? row.payee,
      amount: outflowAmt || row.amount,
      direction: "OUTFLOW",
    }));
    const due = navState.prefillDate ?? todayStr();
    if (due > todayStr()) {
      setForecastExpanded(true);
      setPastExpanded(false);
    } else {
      setPastExpanded(true);
    }
    hasAppliedBillPrefill.current = true;
  }, [accountId, navState?.prefillDate, navState?.prefillPayee, navState?.prefillAmount]);

  const categories = categoriesData?.results ?? [];
  const categoriesForDropdown = useMemo(() => {
    const sorted = [...categories].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
    );
    return sorted.map((c) => ({ ...c, label: c.name }));
  }, [categories]);

  const selectedCategory = useMemo(
    () => (inlineRow.category_id ? categories.find((c) => c.id === inlineRow.category_id) : null),
    [categories, inlineRow.category_id]
  );
  const isTransferCategory = isTransferCategoryName(selectedCategory?.name);

  const transferToAccounts = useMemo(() => {
    if (!account || !accountId) return [];
    const sameHousehold = account.household?.id;
    return accounts.filter(
      (a) =>
        a.id !== accountId &&
        a.household?.id === sameHousehold &&
        (selectedCategory?.name === "Credit Card Payment" ? a.account_type === "CREDIT" : true)
    );
  }, [account, accountId, accounts, selectedCategory?.name]);

  /** When adding a CC payment from a bank account, show how much is owed on the selected card (same row). */
  const inlinePayToCardAccountId =
    selectedCategory?.name === "Credit Card Payment" &&
    typeof inlineRow.transfer_to_account_id === "number" &&
    inlineRow.transfer_to_account_id > 0
      ? inlineRow.transfer_to_account_id
      : null;

  const inlineProjectionRange = useMemo(
    () => (debouncedInlineDate ? projectionTimelineRangeForAsOf(debouncedInlineDate) : null),
    [debouncedInlineDate]
  );

  const { data: inlineCardTimelineData, isFetching: inlineCardTimelineLoading } = useQuery({
    queryKey: [
      "timeline",
      "card-projection",
      inlinePayToCardAccountId,
      inlineProjectionRange?.start,
      inlineProjectionRange?.end,
      inlineProjectionRange?.as_of,
    ],
    queryFn: () => {
      const range = inlineProjectionRange!;
      return getTimeline({
        start: range.start,
        end: range.end,
        as_of: range.as_of,
        account_id: inlinePayToCardAccountId!,
      });
    },
    enabled: inlinePayToCardAccountId != null && inlineProjectionRange != null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const inlineOwedAsOfPaymentDate = useMemo(() => {
    if (inlinePayToCardAccountId == null || !inlineRow.date || !inlineCardTimelineData?.timeline) return null;
    return creditOwedAsOfDateFromTimeline(
      inlineCardTimelineData.timeline,
      inlinePayToCardAccountId,
      inlineRow.date,
      new Set()
    );
  }, [inlinePayToCardAccountId, inlineRow.date, inlineCardTimelineData?.timeline]);

  const inlineTransferToId =
    typeof inlineRow.transfer_to_account_id === "number" && inlineRow.transfer_to_account_id > 0
      ? inlineRow.transfer_to_account_id
      : null;
  const inlineDestPickAccount =
    inlineTransferToId != null ? accounts.find((a) => a.id === inlineTransferToId) : null;
  const inlineBankTransferDestId =
    isTransferCategory &&
    selectedCategory?.name !== "Credit Card Payment" &&
    inlineDestPickAccount != null &&
    String(inlineDestPickAccount.account_type ?? "").toUpperCase() !== "CREDIT"
      ? inlineTransferToId
      : null;

  const { data: inlineBankDestTimelineData, isFetching: inlineBankDestTimelineLoading } = useQuery({
    queryKey: [
      "timeline",
      "bank-dest-inline",
      inlineBankTransferDestId,
      inlineProjectionRange?.start,
      inlineProjectionRange?.end,
      inlineProjectionRange?.as_of,
    ],
    queryFn: () => {
      const range = inlineProjectionRange!;
      return getTimeline({
        start: range.start,
        end: range.end,
        as_of: range.as_of,
        account_id: inlineBankTransferDestId!,
      });
    },
    enabled: inlineBankTransferDestId != null && inlineProjectionRange != null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const inlineBankDestBalanceBefore = useMemo(() => {
    if (inlineBankTransferDestId == null || !inlineRow.date || !inlineBankDestTimelineData?.timeline) return null;
    return assetBalanceAsOfDateFromTimeline(
      inlineBankDestTimelineData.timeline,
      inlineBankTransferDestId,
      inlineRow.date,
      new Set()
    );
  }, [inlineBankTransferDestId, inlineRow.date, inlineBankDestTimelineData?.timeline]);

  const inlineBankDestBalanceAfter = useMemo(() => {
    if (inlineBankDestBalanceBefore == null) return null;
    const raw = parseFloat(String(inlineRow.amount).trim());
    if (Number.isNaN(raw) || raw === 0) return null;
    const absAmt = Math.abs(raw);
    // "Transfer to" is the counterparty. Outflow from the ledger account → they receive +abs. Inflow here → they send −abs.
    const deltaOnCounterparty = raw < 0 ? absAmt : -absAmt;
    return inlineBankDestBalanceBefore + deltaOnCounterparty;
  }, [inlineBankDestBalanceBefore, inlineRow.amount]);

  const editCategory = useMemo(
    () => (editForm.category_id ? categories.find((c) => c.id === editForm.category_id) : null),
    [categories, editForm.category_id]
  );
  const editIsLinkedTransfer = Boolean(
    editing && (editing as { transfer_to_account?: unknown }).transfer_to_account
  );
  const editIsTransferCategoryName = (name: string | undefined) => isTransferCategoryName(name);
  /** Account this row belongs to (updates when user changes Account in the modal). */
  const editSourceAccount = useMemo(() => {
    if (!editing) return null;
    const id =
      editForm.account_id !== "" && editForm.account_id !== undefined
        ? Number(editForm.account_id)
        : (editing.account_id ?? (editing.account as { id?: number })?.id);
    if (id == null || Number.isNaN(id)) return null;
    return accounts.find((a) => a.id === id) ?? null;
  }, [editing, editForm.account_id, accounts]);
  /** Inflow on a credit card: this row is money arriving on the card (payment received), not leaving checking. */
  const editIsCreditCardInflow =
    editSourceAccount != null &&
    String(editSourceAccount.account_type ?? "").toUpperCase() === "CREDIT" &&
    editForm.direction === "INFLOW";
  /** Incoming leg of an existing two-sided transfer — destination is chosen on the outflow row only. */
  const editIsTransferInflowLeg =
    editForm.direction === "INFLOW" &&
    Boolean(
      editing &&
        ((editing as { linked_transaction_id?: number | null }).linked_transaction_id != null ||
          editIsLinkedTransfer)
    );
  /** “Payment to” / “Transfer to” only applies when money is leaving another account toward a destination — not when editing the card side of a payment. */
  const hideEditTransferToSelector =
    (editIsCreditCardInflow || editIsTransferInflowLeg) &&
    (editIsLinkedTransfer || editIsTransferCategoryName(editCategory?.name));
  const editTransferCounterparty = editing
    ? ((editing as { transfer_to_account?: { id?: number; name?: string } | null }).transfer_to_account ?? null)
    : null;
  const editTransferToAccounts = useMemo(() => {
    if (!editing || !account) return [];
    const fromAccountId =
      editForm.account_id !== "" && editForm.account_id !== undefined
        ? Number(editForm.account_id)
        : (editing.account_id ?? editing.account?.id);
    const sameHousehold = account.household?.id;
    const creditOnly = editCategory?.name === "Credit Card Payment";
    return accounts.filter(
      (a) =>
        a.id !== fromAccountId &&
        a.household?.id === sameHousehold &&
        (creditOnly ? a.account_type === "CREDIT" : true)
    );
  }, [editing, account, accounts, editForm.account_id, editForm.category_id, editCategory?.name]);
  const showEditTransferToSelector =
    Boolean(editing) &&
    editForm.direction === "OUTFLOW" &&
    editTransferToAccounts.length > 0 &&
    (editIsLinkedTransfer || editIsTransferCategoryName(editCategory?.name)) &&
    !hideEditTransferToSelector;
  const editDestinationAccount = useMemo(
    () =>
      editForm.transfer_to_account_id
        ? editTransferToAccounts.find((a) => a.id === editForm.transfer_to_account_id)
        : null,
    [editForm.transfer_to_account_id, editTransferToAccounts]
  );
  const editDirectionIsPaymentLike =
    editCategory?.name === "Credit Card Payment" ||
    (editIsLinkedTransfer &&
      editDestinationAccount != null &&
      String(editDestinationAccount.account_type ?? "").toUpperCase() === "CREDIT");

  const editPayToCardId =
    showEditTransferToSelector &&
    editCategory?.name === "Credit Card Payment" &&
    typeof editForm.transfer_to_account_id === "number" &&
    editForm.transfer_to_account_id > 0
      ? editForm.transfer_to_account_id
      : null;

  /** Bank / cash destination (not credit card payment) — show projected balances like CC payoff box. */
  const editBankTransferDestId =
    showEditTransferToSelector &&
    editCategory?.name !== "Credit Card Payment" &&
    editDestinationAccount != null &&
    String(editDestinationAccount.account_type ?? "").toUpperCase() !== "CREDIT" &&
    typeof editForm.transfer_to_account_id === "number" &&
    editForm.transfer_to_account_id > 0
      ? editForm.transfer_to_account_id
      : null;

  const editExcludeTxnIds = useMemo(() => {
    const s = new Set<number>();
    if (!editing) return s;
    if (editing.linked_transaction_id != null) s.add(editing.linked_transaction_id);
    s.add(editing.id);
    return s;
  }, [editing]);

  const editProjectionRange = useMemo(
    () => (debouncedEditDate ? projectionTimelineRangeForAsOf(debouncedEditDate) : null),
    [debouncedEditDate]
  );

  const { data: editCardTimelineData, isFetching: editCardTimelineLoading } = useQuery({
    queryKey: [
      "timeline",
      "card-projection",
      editPayToCardId,
      editProjectionRange?.start,
      editProjectionRange?.end,
      editProjectionRange?.as_of,
      editing?.id,
    ],
    queryFn: () => {
      const range = editProjectionRange!;
      return getTimeline({
        start: range.start,
        end: range.end,
        as_of: range.as_of,
        account_id: editPayToCardId!,
      });
    },
    enabled: editPayToCardId != null && editProjectionRange != null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const editOwedAsOfPaymentDate = useMemo(() => {
    if (editPayToCardId == null || !editForm.date || !editCardTimelineData?.timeline) return null;
    return creditOwedAsOfDateFromTimeline(
      editCardTimelineData.timeline,
      editPayToCardId,
      editForm.date,
      editExcludeTxnIds
    );
  }, [editPayToCardId, editForm.date, editCardTimelineData?.timeline, editExcludeTxnIds]);

  const { data: editBankDestTimelineData, isFetching: editBankDestTimelineLoading } = useQuery({
    queryKey: [
      "timeline",
      "bank-dest-projection",
      editBankTransferDestId,
      editProjectionRange?.start,
      editProjectionRange?.end,
      editProjectionRange?.as_of,
      editing?.id,
    ],
    queryFn: () => {
      const range = editProjectionRange!;
      return getTimeline({
        start: range.start,
        end: range.end,
        as_of: range.as_of,
        account_id: editBankTransferDestId!,
      });
    },
    enabled: editBankTransferDestId != null && editProjectionRange != null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const editBankDestBalanceExcludingTransfer = useMemo(() => {
    if (editBankTransferDestId == null || !editForm.date || !editBankDestTimelineData?.timeline) return null;
    return assetBalanceAsOfDateFromTimeline(
      editBankDestTimelineData.timeline,
      editBankTransferDestId,
      editForm.date,
      editExcludeTxnIds
    );
  }, [editBankTransferDestId, editForm.date, editBankDestTimelineData?.timeline, editExcludeTxnIds]);

  const editBankDestBalanceAfterTransfer = useMemo(() => {
    if (editBankDestBalanceExcludingTransfer == null) return null;
    const amt = parseFloat(String(editForm.amount).trim());
    if (Number.isNaN(amt)) return null;
    // transfer_to_account is always the *other* leg (see API serializer). OUTFLOW on this row → counterparty gains amt;
    // INFLOW on this row → counterparty is the sender, so their balance drops by amt.
    const deltaOnCounterparty = editForm.direction === "OUTFLOW" ? amt : -amt;
    return editBankDestBalanceExcludingTransfer + deltaOnCounterparty;
  }, [editBankDestBalanceExcludingTransfer, editForm.amount, editForm.direction]);

  const editAccounts = useMemo(() => {
    if (!editing) return [];
    const householdId =
      (editing.account as { household?: { id: number } })?.household?.id ??
      (account?.household as { id?: number })?.id;
    if (householdId == null) return [];
    return accounts
      .filter((a) => {
        const ahId = typeof a.household === "object" && a.household != null ? (a.household as { id: number }).id : a.household;
        return ahId === householdId;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [editing, account, accounts]);

  const isCreditAccount = Boolean(
    account && String((account as { account_type?: string; accountType?: string }).account_type ?? (account as { accountType?: string }).accountType ?? "").toUpperCase() === "CREDIT"
  );

  const householdId =
    account && typeof account.household === "object" && account.household != null && "id" in account.household
      ? (account.household as { id: number }).id
      : typeof account?.household === "number"
        ? account.household
        : null;

  const plaidHouseholdId = householdId ?? profile?.default_household ?? null;

  const timelinePatchScope = useMemo((): TimelinePatchScope | null => {
    if (typeof accountId !== "number") return null;
    return {
      timelineStart,
      timelineEnd,
      accountId,
      today: todayStr(),
      householdId,
    };
  }, [timelineStart, timelineEnd, accountId, householdId]);

  const accountsForHousehold = useMemo(() => {
    if (householdId == null) return [];
    return accounts.filter((a) => {
      const ahId =
        typeof a.household === "object" && a.household != null && "id" in a.household
          ? (a.household as { id: number }).id
          : typeof a.household === "number"
            ? a.household
            : null;
      const st = a.status ?? (a.archived ? "archived" : "active");
      return ahId === householdId && st === "active";
    });
  }, [accounts, householdId]);

  const { data: householdTimelineData } = useQuery({
    queryKey: ["timeline", "household", timelineStart, timelineEnd, householdId, todayStr()],
    queryFn: () =>
      getTimeline({
        start: timelineStart,
        end: timelineEnd,
        as_of: todayStr(),
        household_id: householdId ?? undefined,
      }),
    enabled: !!householdId && !!timelineStart && !!timelineEnd && loadHouseholdWarnings,
    staleTime: 120_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const today = todayStr();
  /** For each non-credit account: first date on or after today when balance goes negative (if any). */
  const negativeBalanceWarnings = useMemo(() => {
    const timeline = householdTimelineData?.timeline ?? [];
    const nonCredit = accountsForHousehold.filter((a) => String((a.account_type ?? "").toUpperCase()) !== "CREDIT");
    const warnings: { accountName: string; date: string }[] = [];
    for (const acc of nonCredit) {
      const futureRows = timeline
        .filter((r) => Number(r.account_id) === Number(acc.id) && r.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      const firstNegative = futureRows.find((r) => parseFloat(r.running_balance) < 0);
      if (firstNegative) {
        warnings.push({
          accountName: acc.name,
          date: firstNegative.date,
        });
      }
    }
    return warnings.sort((a, b) => a.date.localeCompare(b.date));
  }, [householdTimelineData?.timeline, accountsForHousehold, today]);

  /** For each credit account with a limit: first date on or after today when balance goes over the credit limit (debt exceeds limit). */
  const creditLimitWarnings = useMemo(() => {
    const timeline = householdTimelineData?.timeline ?? [];
    const creditAccounts = accountsForHousehold.filter(
      (a) =>
        String((a.account_type ?? "").toUpperCase()) === "CREDIT" &&
        a.credit_limit != null &&
        String(a.credit_limit).trim() !== ""
    );
    const warnings: { accountName: string; date: string }[] = [];
    for (const acc of creditAccounts) {
      const limit = parseFloat(String(acc.credit_limit));
      if (Number.isNaN(limit) || limit <= 0) continue;
      const futureRows = timeline
        .filter((r) => Number(r.account_id) === Number(acc.id) && r.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      const firstOverLimit = futureRows.find((r) => {
        const bal = parseFloat(r.running_balance);
        return bal < -limit;
      });
      if (firstOverLimit) {
        warnings.push({
          accountName: acc.name,
          date: firstOverLimit.date,
        });
      }
    }
    return warnings.sort((a, b) => a.date.localeCompare(b.date));
  }, [householdTimelineData?.timeline, accountsForHousehold, today]);

  const ledgerRows = useMemo(() => {
    if (!account || typeof accountId !== "number") return [];
    const today = todayStr();
    const openingBalance =
      account.starting_balance != null && String(account.starting_balance).trim() !== ""
        ? parseFloat(account.starting_balance)
        : 0;
    const start = openingBalance;
    const timeline = timelineData?.timeline;
    if (timelineHasAccountRows(timeline, accountId)) {
      const aid = Number(accountId);
      const timelineForAccount = timeline!.filter((r) => Number(r.account_id) === aid);
      return buildLedgerRowsFromTimeline(timelineForAccount, today, openingBalance, isCreditAccount);
    }
    // Timeline missing, slow, errored, or empty on Render — show posted transactions immediately.
    return buildLedgerRows(transactions, start, account.currency, isCreditAccount);
  }, [account, accountId, transactions, timelineData?.timeline, isCreditAccount]);

  /** Split into: start, past, today, future (scheduled transactions under Today's Ending Balance). */
  const ledgerSections = useMemo(() => splitLedgerSections(ledgerRows), [ledgerRows]);

  const pastRowFilters = useMemo(
    () => ({
      kind: kindFilter,
      reconciled: reconciledFilter,
      amountMin: parseAmountFilterInput(debouncedAmountMinInput),
      amountMax: parseAmountFilterInput(debouncedAmountMaxInput),
    }),
    [kindFilter, reconciledFilter, debouncedAmountMinInput, debouncedAmountMaxInput]
  );

  const filteredPastRows = useMemo(
    () => filterLedgerPastRows(ledgerSections.past, pastRowFilters),
    [ledgerSections.past, pastRowFilters]
  );

  const pastFiltersActive = hasActiveLedgerRowFilters(pastRowFilters);
  const firstNegativeForecastBalance = useMemo(() => {
    const firstNegative = ledgerSections.future.find(
      (row): row is Extract<(typeof ledgerSections.future)[number], { type: "recurring" }> =>
        row.type === "recurring" && row.balance < 0
    );
    return firstNegative ? firstNegative.balance : null;
  }, [ledgerSections.future]);

  const resetInlineRow = () => {
    setInlineRow((prev) => ({
      ...prev,
      payee: "",
      category_id: "",
      transfer_to_account_id: "",
      amount: "",
      direction: "OUTFLOW",
    }));
  };

  const transactionsQueryKey = useMemo(
    () =>
      [
        "transactions",
        { account: accountId || undefined, date_after: timelineStart, date_before: timelineEnd },
      ] as const,
    [accountId, timelineStart, timelineEnd]
  );

  const createMu = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      refreshAfterTransactionEdit(queryClient, timelinePatchScope, { refreshAccounts: true });
      resetInlineRow();
    },
  });

  const createTransferMu = useMutation({
    mutationFn: (body: Parameters<typeof createTransfer>[0]) => createTransfer(body),
    onSuccess: (_data, variables) => {
      refreshAfterTransactionEdit(queryClient, timelinePatchScope, { refreshAccounts: true });
      void queryClient.refetchQueries({ queryKey: ["account", variables.from_account], type: "active" });
      void queryClient.refetchQueries({ queryKey: ["account", variables.to_account], type: "active" });
      resetInlineRow();
    },
  });

  const updateMu = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: {
        date?: string;
        payee?: string;
        amount?: string;
        category_id?: number | null;
        account_id?: number;
        memo?: string;
        transfer_to_account_id?: number;
        rule_id?: number | null;
      };
    }) => updateTransaction(id, data),
    onMutate: async ({ id, data }) => {
      setDeleteError(null);
      const snapshot = { editing, editForm, editingRuleId, applyToRule };
      setEditing(null);
      setEditingRuleId(null);
      setApplyToRule(false);

      if (timelinePatchScope) {
        patchTimelineCachesForTransaction(queryClient, timelinePatchScope, {
          transactionId: id,
          date: data.date,
          payee: data.payee,
          amount: data.amount,
        });
      }

      await queryClient.cancelQueries({ queryKey: transactionsQueryKey });
      const previousTxns = queryClient.getQueryData(transactionsQueryKey);
      queryClient.setQueryData(
        transactionsQueryKey,
        (old: { results?: Transaction[] } | undefined) => {
          if (!old?.results) return old;
          return {
            ...old,
            results: old.results.map((t) =>
              t.id === id
                ? {
                    ...t,
                    ...(data.date != null && { date: data.date }),
                    ...(data.payee != null && { payee: data.payee }),
                    ...(data.amount != null && { amount: data.amount }),
                    ...(data.category_id !== undefined && { category_id: data.category_id }),
                    ...(data.memo != null && { memo: data.memo }),
                    ...(data.account_id != null && { account_id: data.account_id }),
                  }
                : t
            ),
          };
        }
      );
      return { ...snapshot, previousTxns, transactionsQueryKey };
    },
    onError: (err: Error, _vars, context) => {
      if (context?.previousTxns != null && context?.transactionsQueryKey) {
        queryClient.setQueryData(context.transactionsQueryKey, context.previousTxns);
      }
      if (context?.editing) {
        setEditing(context.editing);
        setEditForm(context.editForm);
        setEditingRuleId(context.editingRuleId);
        setApplyToRule(context.applyToRule);
      }
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setDeleteError(msg || "Failed to save transaction");
    },
    onSuccess: async (updatedTxn, variables) => {
      setDeleteError(null);
      const txnId = variables.id;
      const newAccountId = variables.data.account_id;
      const syncedToAccountId = (updatedTxn as { synced_to_account_id?: number }).synced_to_account_id;
      if (timelinePatchScope) {
        patchTimelineCachesForTransaction(queryClient, timelinePatchScope, {
          transactionId: txnId,
          date: updatedTxn.date,
          payee: updatedTxn.payee,
          amount: updatedTxn.amount != null ? String(updatedTxn.amount) : undefined,
        });
      }
      const affectsBalances =
        variables.data.amount != null ||
        variables.data.date != null ||
        variables.data.account_id != null;
      refreshAfterTransactionEdit(queryClient, timelinePatchScope, {
        refreshAccounts: affectsBalances,
        skipTransactionsInvalidate: affectsBalances,
      });
      if (newAccountId != null) setAccountId(newAccountId);
      if (syncedToAccountId != null) {
        void queryClient.refetchQueries({ queryKey: ["account", syncedToAccountId], type: "active" });
      }
    },
  });

  const deleteMu = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: () => {
      setDeleteError(null);
      refreshAfterTransactionEdit(queryClient, timelinePatchScope, { refreshAccounts: true });
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setDeleteError(msg || "Failed to delete transaction");
    },
  });

  const cleanupOrphansMu = useMutation({
    mutationFn: cleanupOrphanedRuleRows,
    onSuccess: async (data) => {
      setOrphanCleanupMessage(
        data.deleted === 0
          ? "No orphaned automation rows found (future dated, from automation source, no link)."
          : `Removed ${data.deleted} orphaned row(s). Refresh if counts look off.`
      );
      refreshAfterTransactionEdit(queryClient, timelinePatchScope, { refreshAccounts: true });
      if (householdId != null && timelinePatchScope) {
        scheduleTimelineRefresh(queryClient, timelinePatchScope);
      }
    },
    onError: (err: Error) => {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setOrphanCleanupMessage(msg || "Cleanup failed");
    },
  });

  function openEdit(txn: Transaction) {
    setDeleteError(null);
    setEditing(txn);
    const ruleId = (txn as { rule_id?: number | null }).rule_id ?? null;
    setEditingRuleId(ruleId);
    setApplyToRule(false);
    const amt = parseFloat(txn.amount);
    const transferTo = (txn as { transfer_to_account?: { id: number; name?: string } | null }).transfer_to_account;
    const transferToId = transferTo?.id ?? "";
    const txnAccountId = txn.account_id ?? (txn.account as { id: number })?.id;
    const cardName = transferTo && "name" in transferTo ? String(transferTo.name) : "";
    const basePayee = (txn.payee || "").trim().replace(/\s*\([^)]+\)(?:\s*\([^)]+\))*\s*$/g, "").trim();
    const payeeWithCard =
      cardName && basePayee ? `${basePayee} (${cardName})` : basePayee || cardName || "";
    setEditForm({
      date: txn.date,
      payee: payeeWithCard,
      category_id: (txn.category?.id ?? txn.category_id) ?? "",
      account_id: txnAccountId ?? "",
      amount: String(Math.abs(amt)),
      direction: amt >= 0 ? "INFLOW" : "OUTFLOW",
      transfer_to_account_id: transferToId,
    });
  }

  async function openEditByTimelineId(transactionId: number) {
    try {
      setDeleteError(null);
      const txn = await getTransaction(transactionId);
      openEdit(txn);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not load transaction for edit");
    }
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const amt = parseFloat(editForm.amount);
    if (!editForm.amount.trim() || amt === 0 || Number.isNaN(amt)) return;
    const absAmt = Math.abs(amt);
    const origAmt = parseFloat(editing.amount);
    const origSign = origAmt < 0 ? -1 : origAmt > 0 ? 1 : 0;
    const impliedOutflow = origSign < 0;
    const dirOutflow = editForm.direction === "OUTFLOW";
    const signedAmount =
      origSign === 0
        ? dirOutflow
          ? -absAmt
          : absAmt
        : impliedOutflow === dirOutflow
          ? origSign * absAmt
          : dirOutflow
            ? -absAmt
            : absAmt;
    const linkedTransfer = Boolean((editing as { transfer_to_account?: unknown }).transfer_to_account);
    const editCat = editForm.category_id ? categories.find((c) => c.id === editForm.category_id) : null;
    const transferCategory = isTransferCategoryName(editCat?.name);
    const editAccountIdSubmit =
      editForm.account_id !== "" && editForm.account_id !== undefined
        ? Number(editForm.account_id)
        : (editing.account_id ?? (editing.account as { id?: number })?.id);
    const editSrcSubmit =
      editAccountIdSubmit != null ? accounts.find((a) => a.id === editAccountIdSubmit) : null;
    const omitTransferToOnSubmit =
      editForm.direction === "INFLOW" &&
      (linkedTransfer || transferCategory);
    const includeTransferToOnSubmit =
      !omitTransferToOnSubmit &&
      editForm.direction === "OUTFLOW" &&
      editForm.transfer_to_account_id &&
      (linkedTransfer || transferCategory);
    const payload = {
      date: editForm.date,
      payee: editForm.payee || "—",
      amount: String(signedAmount),
      category_id: editForm.category_id || null,
      ...(editForm.account_id ? { account_id: editForm.account_id as number } : {}),
      ...(includeTransferToOnSubmit
        ? { transfer_to_account_id: editForm.transfer_to_account_id as number }
        : {}),
    };
    if (applyToRule && editingRuleId != null) {
      const ruleDirection =
        includeTransferToOnSubmit
          ? "TRANSFER"
          : editForm.direction === "INFLOW"
            ? "INCOME"
            : "EXPENSE";
      try {
        await updateRule(editingRuleId, {
          name: editForm.payee || "—",
          amount: String(Math.abs(amt)),
          category_id: editForm.category_id || null,
          account_id: editForm.account_id ? (editForm.account_id as number) : undefined,
          direction: ruleDirection,
          ...(includeTransferToOnSubmit
            ? { transfer_to_account_id: editForm.transfer_to_account_id as number }
            : {}),
        });
        queryClient.invalidateQueries({ queryKey: ["rules"] });
        queryClient.invalidateQueries({ queryKey: ["timeline"] });
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Failed to update automation");
        return;
      }
    }
    updateMu.mutate({ id: editing.id, data: payload });
  }

  function handleInlineAdd(e?: React.FormEvent) {
    e?.preventDefault();
    const signedAmt = parseFloat(inlineRow.amount);
    if (!accountId || !inlineRow.amount.trim() || signedAmt === 0 || Number.isNaN(signedAmt)) return;

    if (isTransferCategory && inlineRow.transfer_to_account_id) {
      const absAmt = Math.abs(signedAmt);
      const isOutflow = signedAmt < 0;
      createTransferMu.mutate({
        from_account: (isOutflow ? accountId : inlineRow.transfer_to_account_id) as number,
        to_account: (isOutflow ? inlineRow.transfer_to_account_id : accountId) as number,
        amount: String(absAmt),
        date: inlineRow.date,
        payee: inlineRow.payee.trim(),
        from_category_id: inlineRow.category_id ? inlineRow.category_id : undefined,
      });
    } else {
      createMu.mutate({
        account_id: accountId,
        date: inlineRow.date,
        payee: inlineRow.payee || "—",
        amount: String(signedAmt),
        category_id: inlineRow.category_id || null,
        memo: "",
        ...(navState?.fromBillChecklist ? { is_bill: true } : {}),
      });
    }
  }

  const currency = account?.currency ?? "USD";
  const isCredit = isCreditAccount;

  const householdWarnings = useMemo(
    () => [
      ...negativeBalanceWarnings.map((w) => ({ ...w, kind: "negative" as const })),
      ...creditLimitWarnings.map((w) => ({ ...w, kind: "credit_limit" as const })),
    ],
    [negativeBalanceWarnings, creditLimitWarnings]
  );

  function confirmDelete(id: number, label: string) {
    setDeleteError(null);
    if (window.confirm(`Delete ${label}?`)) deleteMu.mutate(id);
  }

  function confirmSkip(id: number, label: string) {
    setDeleteError(null);
    if (
      window.confirm(
        `Skip this occurrence of "${label}"? This removes only this scheduled transaction.`
      )
    ) {
      deleteMu.mutate(id);
    }
  }

  function duplicateTransaction(txn: Transaction) {
    if (!accountId) return;
    createMu.mutate({
      account_id: accountId as number,
      date: txn.date,
      payee: txn.payee || "—",
      amount: txn.amount,
      category_id: (txn.category_id ?? txn.category?.id ?? null) as number | null,
      memo: txn.memo ?? "",
    });
  }

  async function duplicateByTimelineId(id: number) {
    try {
      const txn = await getTransaction(id);
      duplicateTransaction(txn);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not duplicate transaction");
    }
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden w-full px-4 sm:px-6 lg:px-8 pt-2 pb-6">
      {isPlaidOAuthReturn ? (
        <div className="sr-only" aria-hidden>
          <PlaidConnectBar householdId={plaidHouseholdId} />
        </div>
      ) : null}

      <div className="flex justify-between items-start gap-4 mb-3 flex-shrink-0 flex-wrap">
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          {account && ledgerSections.today?.type === "today_balance" && (
            <ForecastSummaryBar
              account={account}
              currentBalance={
                ledgerSections.today?.balance ??
                accountLedgerDisplayBalance(account, isCredit)
              }
              isCredit={isCredit}
              currency={currency}
              nextRiskDate={account.risk_date ?? null}
              firstNegativeAmount={firstNegativeForecastBalance}
              householdWarnings={householdWarnings}
              expanded={forecastSummaryExpanded}
              onToggle={() => setForecastSummaryExpanded((v) => !v)}
            />
          )}

          {accountId && isCreditAccount && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
              <span className="text-xs font-medium text-slate-600">Payoff:</span>
              <span className="text-slate-400 text-xs">$</span>
              <input
                type="number"
                step="1"
                min="1"
                placeholder="e.g. 150"
                value={payoffPayment}
                onChange={(e) => {
                  setPayoffPayment(e.target.value);
                  setPayoffResult(null);
                  setPayoffError(null);
                }}
                className="w-16 rounded border border-slate-300 px-1.5 py-1 text-xs"
              />
              <span className="text-slate-500 text-xs">/mo</span>
              <button
                type="button"
                onClick={async () => {
                  const val = payoffPayment.trim();
                  if (!val || Number(val) <= 0) {
                    setPayoffError("Enter a positive amount.");
                    return;
                  }
                  setPayoffLoading(true);
                  setPayoffError(null);
                  setPayoffResult(null);
                  try {
                    const res = await getAccountPayoff(accountId as number, {
                      monthly_payment: val,
                    });
                    setPayoffResult(res);
                  } catch (err: unknown) {
                    setPayoffError(err instanceof Error ? err.message : "Failed to load payoff.");
                  } finally {
                    setPayoffLoading(false);
                  }
                }}
                disabled={payoffLoading || !payoffPayment.trim()}
                className="px-1.5 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {payoffLoading ? "…" : "Calc"}
              </button>
              {payoffError && <span className="text-xs text-red-600">{payoffError}</span>}
              {payoffResult != null && payoffResult.months_to_payoff > 0 && (
                <span className="text-xs text-slate-700">
                  → {payoffResult.months_to_payoff} pmts
                  {payoffResult.payoff_date && <> by {formatDateDisplay(payoffResult.payoff_date)}</>}
                </span>
              )}
              {payoffResult != null && payoffResult.months_to_payoff === 0 && (
                <span className="text-xs text-green-700">Paid off</span>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 items-end flex-wrap flex-shrink-0">
          <MaintenanceMenu
            onCleanupOrphans={() => {
              setOrphanCleanupMessage(null);
              cleanupOrphansMu.mutate();
            }}
            cleanupPending={cleanupOrphansMu.isPending}
            orphanMessage={orphanCleanupMessage}
            onDismissMessage={() => setOrphanCleanupMessage(null)}
          />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">Date Range</label>
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="14d">14 days</option>
              <option value="1m">1 month</option>
              <option value="3m">3 months</option>
              <option value="6m">6 months</option>
              <option value="12m">12 months</option>
              <option value="18m">18 months</option>
              <option value="24m">24 months</option>
              <option value="36m">36 months</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-0.5">Account</label>
            <select
              value={accountId === "" ? "" : String(accountId)}
              onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">Select an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountOptionLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <TransactionsFilterBar
            kindFilter={kindFilter}
            onKindFilterChange={setKindFilter}
            reconciledFilter={reconciledFilter}
            onReconciledFilterChange={setReconciledFilter}
            amountMin={amountMinInput}
            amountMax={amountMaxInput}
            onAmountMinChange={setAmountMinInput}
            onAmountMaxChange={setAmountMaxInput}
            showClear={pastFiltersActive}
            onClear={() => {
              setKindFilter("");
              setReconciledFilter("");
              setAmountMinInput("");
              setAmountMaxInput("");
            }}
          />
        </div>
      </div>

      {deleteError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm flex items-center justify-between gap-2">
          <span>{deleteError}</span>
          <button type="button" onClick={() => setDeleteError(null)} className="text-red-600 hover:underline shrink-0">
            Dismiss
          </button>
        </div>
      )}

      {!accountId ? (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          Select an account to view the transaction ledger
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow overflow-hidden">
          {timelineFetching && transactions.length > 0 ? (
            <p
              className="shrink-0 text-sm text-amber-900/80 bg-amber-50/80 border-b border-amber-100 px-4 py-1.5"
              role="status"
            >
              Updating forecast in the background…
            </p>
          ) : null}
          {timelineError && !timelineFetching && transactions.length > 0 ? (
            <p
              className="shrink-0 text-sm text-amber-900 bg-amber-50 border-b border-amber-200 px-4 py-2"
              role="status"
            >
              Timeline could not load (server may have timed out). Showing posted transactions only.
            </p>
          ) : null}
          <PastSection
            start={ledgerSections.start}
            past={filteredPastRows}
            totalUnfilteredCount={pastFiltersActive ? ledgerSections.past.length : undefined}
            currency={currency}
            isCredit={isCredit}
            expanded={pastExpanded}
            minimized={forecastExpanded}
            onToggleExpanded={() => {
              setPastExpanded((v) => {
                const next = !v;
                if (next) setForecastExpanded(false);
                return next;
              });
            }}
            accountId={accountId}
            onEditTimeline={openEditByTimelineId}
            onEditTransaction={openEdit}
            onDuplicateById={duplicateByTimelineId}
            onDuplicate={duplicateTransaction}
            onDelete={confirmDelete}
            deletePending={deleteMu.isPending}
          />

          <div className="flex-none shrink-0 z-10">
          <InlineAddRow
            form={inlineRow}
            onChange={(patch) => setInlineRow((r) => ({ ...r, ...patch }))}
            onSubmit={() => handleInlineAdd()}
            onCancel={resetInlineRow}
            categories={categoriesForDropdown}
            transferToAccounts={transferToAccounts}
            isTransferCategory={isTransferCategory}
            transferCategoryName={selectedCategory?.name}
            isPending={createMu.isPending || createTransferMu.isPending}
            currency={currency}
            inlinePayToCardAccountId={inlinePayToCardAccountId}
            inlineCardTimelineLoading={inlineCardTimelineLoading}
            inlineOwedAsOfPaymentDate={inlineOwedAsOfPaymentDate}
            inlineBankTransferDestId={inlineBankTransferDestId}
            inlineBankDestTimelineLoading={inlineBankDestTimelineLoading}
            inlineDestPickAccount={inlineDestPickAccount}
            inlineBankDestBalanceBefore={inlineBankDestBalanceBefore}
            inlineBankDestBalanceAfter={inlineBankDestBalanceAfter}
            cardCurrency={accounts.find((a) => a.id === inlinePayToCardAccountId)?.currency}
          />
          </div>

          <ForecastCardsSection
            future={ledgerSections.future}
            currency={currency}
            isCredit={isCredit}
            isCreditAccount={isCreditAccount}
            expanded={forecastExpanded}
            hiddenByPast={pastExpanded}
            onToggleExpanded={() => {
              setForecastExpanded((v) => {
                const next = !v;
                if (next) setPastExpanded(false);
                return next;
              });
            }}
            onEditTimeline={openEditByTimelineId}
            onSkip={confirmSkip}
            onDelete={confirmDelete}
            deletePending={deleteMu.isPending}
            minimumBuffer={
              account?.minimum_buffer != null && String(account.minimum_buffer).trim() !== ""
                ? parseFloat(String(account.minimum_buffer))
                : null
            }
            riskDate={account?.risk_date ?? null}
          />
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-20">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">Edit transaction</h2>
            {deleteError && (
              <div
                role="alert"
                className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm flex items-start justify-between gap-2"
              >
                <span>{deleteError}</span>
                <button
                  type="button"
                  onClick={() => setDeleteError(null)}
                  className="text-red-600 hover:underline shrink-0 text-sm"
                >
                  Dismiss
                </button>
              </div>
            )}
            <form onSubmit={handleEditSubmit} className="space-y-4">
              {editAccounts.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Account</label>
                  <select
                    value={editForm.account_id}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, account_id: e.target.value ? Number(e.target.value) : "" }))
                    }
                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    required
                  >
                    <option value="">Select account</option>
                    {editAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Date</label>
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Payee</label>
                <input
                  type="text"
                  value={editForm.payee}
                  onChange={(e) => setEditForm((f) => ({ ...f, payee: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                />
                {showEditTransferToSelector && editForm.transfer_to_account_id && editDestinationAccount && (
                  <p className="mt-1 text-xs text-gray-500">
                    {editCategory?.name === "Credit Card Payment" || String(editDestinationAccount.account_type ?? "").toUpperCase() === "CREDIT"
                      ? (
                        <>
                          Payment into: <strong>{editDestinationAccount.name}</strong>
                        </>
                      )
                      : (
                        <>
                          Transfers to: <strong>{editDestinationAccount.name}</strong>
                        </>
                      )}
                  </p>
                )}
                {hideEditTransferToSelector && editTransferCounterparty?.name && (
                  <p className="mt-1 text-xs text-gray-500">
                    Paid from: <strong>{editTransferCounterparty.name}</strong>
                    {editCategory?.name === "Credit Card Payment" ? " (edit that payment on the paying account to change the bank side)." : ""}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Category</label>
                <select
                  value={editForm.category_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, category_id: e.target.value ? Number(e.target.value) : "" }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                >
                  <option value="">None</option>
                  {categoriesForDropdown.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                {editIsLinkedTransfer && editCategory?.name !== "Credit Card Payment" && (
                  <p className="mt-1 text-xs text-gray-500">
                    For card payments, choose category <strong>Credit Card Payment</strong> so reporting matches a payoff.
                  </p>
                )}
              </div>
              {showEditTransferToSelector && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    {editCategory?.name === "Credit Card Payment"
                      ? "Payment to (credit card)"
                      : "Transfer to account"}
                  </label>
                  <select
                    value={editForm.transfer_to_account_id}
                    onChange={(e) => {
                      const newId = e.target.value ? Number(e.target.value) : "";
                      const picked = editTransferToAccounts.find((a) => a.id === newId);
                      const pickedName = picked?.name ?? "";
                      setEditForm((f) => {
                        const base = (f.payee || "").replace(/\s*\([^)]+\)(?:\s*\([^)]+\))*\s*$/g, "").trim();
                        return {
                          ...f,
                          transfer_to_account_id: newId,
                          payee: base ? (pickedName ? `${base} (${pickedName})` : base) : pickedName,
                        };
                      });
                    }}
                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    required={editIsLinkedTransfer || editIsTransferCategoryName(editCategory?.name)}
                  >
                    <option value="">
                      {editCategory?.name === "Credit Card Payment" ? "Select credit card" : "Select account"}
                    </option>
                    {editTransferToAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {editPayToCardId != null && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-medium text-gray-700">
                    Projected balance owed on card (as of {formatDateDisplay(editForm.date)})
                  </div>
                  {editCardTimelineLoading ? (
                    <p className="text-xs text-gray-500 mt-1">Loading…</p>
                  ) : (
                    <p className="text-base font-semibold text-red-700 tabular-nums mt-0.5">
                      {editOwedAsOfPaymentDate != null
                        ? formatCurrency(
                            String(editOwedAsOfPaymentDate),
                            accounts.find((a) => a.id === editPayToCardId)?.currency ?? currency
                          )
                        : "—"}
                    </p>
                  )}
                  <p className="text-[11px] text-gray-500 mt-1">
                    From your timeline: scheduled charges and payments on or before this date. This transfer is excluded
                    so the amount reflects what you still owe besides this payment.
                  </p>
                </div>
              )}
              {editBankTransferDestId != null && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-medium text-gray-700">
                    {editDestinationAccount?.name ?? "Destination"} — balance on{" "}
                    {formatDateDisplay(editForm.date)} (from your timeline)
                  </div>
                  {editBankDestTimelineLoading ? (
                    <p className="text-xs text-gray-500 mt-1">Loading…</p>
                  ) : (
                    <>
                      <div className="mt-2 space-y-1">
                        <div className="text-[11px] text-gray-600">Current (this transfer excluded)</div>
                        <p className="text-sm font-medium text-slate-900 tabular-nums">
                          {editBankDestBalanceExcludingTransfer != null
                            ? formatCurrency(
                                String(editBankDestBalanceExcludingTransfer),
                                editDestinationAccount?.currency ?? currency
                              )
                            : "—"}
                        </p>
                      </div>
                      <div className="mt-2 space-y-1 pt-2 border-t border-slate-200/80">
                        <div className="text-[11px] text-gray-600">Projected after this transfer</div>
                        <p
                          className={`text-base font-semibold tabular-nums ${
                            editBankDestBalanceAfterTransfer != null &&
                            editBankDestBalanceExcludingTransfer != null
                              ? editBankDestBalanceAfterTransfer >= editBankDestBalanceExcludingTransfer
                                ? "text-emerald-800"
                                : "text-amber-900"
                              : "text-slate-900"
                          }`}
                        >
                          {editBankDestBalanceAfterTransfer != null
                            ? formatCurrency(
                                String(editBankDestBalanceAfterTransfer),
                                editDestinationAccount?.currency ?? currency
                              )
                            : "—"}
                        </p>
                      </div>
                    </>
                  )}
                  <p className="text-[11px] text-gray-500 mt-2">
                    Scheduled activity on or before this date is included. The first line is the other account’s balance
                    without this transfer. The second applies it: <strong>Out</strong> from the account above means the
                    other account receives this amount; <strong>In</strong> means it sends this amount (balance goes
                    down).
                  </p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Direction</label>
                <select
                  value={editForm.direction}
                  onChange={(e) => setEditForm((f) => ({ ...f, direction: e.target.value as "INFLOW" | "OUTFLOW" }))}
                  disabled={editIsTransferInflowLeg && editIsLinkedTransfer}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-600"
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
                {editIsTransferInflowLeg && editIsLinkedTransfer && (
                  <p className="mt-1 text-xs text-gray-500">
                    This is the receiving side of a transfer — change the date here and the other account updates automatically.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editForm.amount}
                  onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
              </div>
              {editingRuleId != null && (
                <div>
                  <span className="block text-sm font-medium text-gray-700 mb-2">Apply changes to</span>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="apply-to"
                        checked={!applyToRule}
                        onChange={() => setApplyToRule(false)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>This transaction only</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="apply-to"
                        checked={applyToRule}
                        onChange={() => setApplyToRule(true)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>All future transactions (update automation)</span>
                    </label>
                  </div>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setEditing(null); setEditingRuleId(null); setApplyToRule(false); }}
                  className="py-2 px-4 border rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMu.isPending}
                  className="py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateMu.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
