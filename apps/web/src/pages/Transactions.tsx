import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { keepPreviousData, useInfiniteQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency, formatAccountOptionLabel } from "@budget-app/shared";
import type { Transaction, TimelineRow } from "@budget-app/shared";
import {
  listTransactions,
  listAccounts,
  listCategories,
  createTransaction,
  createTransfer,
  updateTransaction,
  updateRule,
  deleteTransaction,
  skipTransactionOccurrence,
  moveTransactionDate,
  getAccount,
  getTimeline,
  getTransaction,
  resolveRuleOccurrence,
  getAccountPayoff,
  getReconcileSetup,
  ApiError,
  type PayoffProjection,
} from "@budget-app/api-client";
import { PlaidConnectBar } from "../components/PlaidConnectBar";
import ForecastSummaryBar from "../components/transactions/ForecastSummaryBar";
import PastSection from "../components/transactions/PastSection";
import PendingExpectedSection from "../components/transactions/PendingExpectedSection";
import ForecastCardsSection from "../components/transactions/ForecastCardsSection";
import InlineAddRow, { type InlineAddForm } from "../components/transactions/InlineAddRow";
import {
  projectionSelectionKey,
  type TransactionRowData,
} from "../components/transactions/TransactionRow";
import {
  ShowReconciledFilter,
  TransactionColumnFilters,
} from "../components/transactions/TransactionsFilterBar";
import {
  isBankImportedTransaction,
  transactionEditLockMessage,
} from "../components/transactions/transactionStatusUtils";
import {
  filterLedgerPastRows,
  filterLedgerRows,
  hasActiveLedgerRowFilters,
  parseAmountFilterInput,
} from "../components/transactions/ledgerRowFilters";
import {
  todayStr,
  formatDateDisplay,
  addMonths,
  creditOwedAsOfDateFromTimeline,
  creditSignedOpeningBalance,
  pickAccountTimelineForHint,
  hintDateWithinLedgerRange,
  assetBalanceAsOfDateFromTimeline,
  buildLedgerRows,
  buildLedgerRowsFromPastAndUpcomingTimeline,
  hideReconciledOpeningBalance,
  splitLedgerSections,
  currentBalanceFromLedgerSections,
  pendingSectionEndingBalance,
  lowestProjectedFromLedgerFuture,
  firstNegativeFromLedgerFuture,
  isTransferCategoryName,
  accountLedgerDisplayBalance,
  ledgerOpeningBalance,
  pastTransactionsRange,
  ledgerPastTransactionStart,
  ledgerProjectionRange,
  indexTimelineRowsByAccount,
  timelineRowFlowDirection,
  projectionTimelineRangeForAsOf,
  forecastRangeLabel,
  daysToForecastRange,
  forecastRangeToDays,
  type TimeFilter,
  type ForecastRange,
} from "../components/transactions/transactionsLedgerUtils";
import { logTransactionsPageLoadPlan } from "../lib/transactionsPageLoadPerf";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
import { accountLifecycleStatus } from "../lib/accountOrganization";
import { refreshAfterTransactionEdit } from "../lib/financialQueryRefresh";
import {
  loadStoredTransactionsAccountId,
  saveStoredTransactionsAccountId,
  loadStoredTransactionsTimeFilter,
  saveStoredTransactionsTimeFilter,
  loadStoredTransactionsAmountMin,
  loadStoredTransactionsAmountMax,
  saveStoredTransactionsAmountRange,
} from "../lib/transactionsPageState";
import { categoriesForDropdown } from "../lib/categoryOptions";
import { usePageForecastWindow } from "../hooks/usePageForecastWindow";
import { usePerfPageLoad } from "../hooks/usePerfPageLoad";
import { useTransferBalancePreview } from "../hooks/useTransferBalancePreview";

export type { TimeFilter, ForecastRange };

/** Matches mobile TRANSACTIONS_LEDGER_PAGE_SIZE — bounded pages instead of a 2k pseudo-page. */
const WEB_LEDGER_PAGE_SIZE = 500;

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
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navState = (location.state as TransactionsLocationState | null) ?? null;
  const isPlaidOAuthReturn = searchParams.has("oauth_state_id") || navState?.focusPlaid === true;
  const urlAccountId = Number(searchParams.get("account"));
  const urlCategoryId = Number(searchParams.get("category"));
  const urlDate = searchParams.get("date");
  const urlFocus = searchParams.get("focus");
  const hasUrlAccount = Number.isInteger(urlAccountId) && urlAccountId > 0;
  const hasUrlCategory = Number.isInteger(urlCategoryId) && urlCategoryId > 0;
  const [accountId, setAccountId] = useState<number | "">(() => loadStoredTransactionsAccountId());
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => loadStoredTransactionsTimeFilter());
  const {
    forecastDays,
    setForecastDays,
    ready: forecastReady,
    profile,
  } = usePageForecastWindow();
  const forecastRange = daysToForecastRange(forecastDays);
  /** Default OFF — reconciled history is loaded only when the user asks. */
  const [showReconciled, setShowReconciled] = useState(false);
  const hideReconciledPast = !showReconciled;
  const [amountMinInput, setAmountMinInput] = useState(() => loadStoredTransactionsAmountMin());
  const [amountMaxInput, setAmountMaxInput] = useState(() => loadStoredTransactionsAmountMax());
  const hasSetInitialAccount = useRef(false);
  const consumedNavAccountRef = useRef(false);
  const hasAppliedBillPrefill = useRef(false);
  const inlineAddInFlight = useRef(false);

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
  const [pastExpanded, setPastExpanded] = useState(false);
  const [forecastExpanded, setForecastExpanded] = useState(false);
  const [forecastSummaryExpanded, setForecastSummaryExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<number>>(
    () => new Set()
  );
  const [pendingSelectionKeys, setPendingSelectionKeys] = useState<Set<string>>(() => new Set());
  const [editForm, setEditForm] = useState({
    date: todayStr(),
    payee: "",
    category_id: "" as number | "",
    account_id: "" as number | "",
    amount: "",
    direction: "OUTFLOW" as "INFLOW" | "OUTFLOW",
    transfer_to_account_id: "" as number | "",
  });
  const debouncedInlineDate = useDebouncedValue(inlineRow.date, 1200);
  const debouncedEditDate = useDebouncedValue(editForm.date, 1200);
  const debouncedAmountMinInput = useDebouncedValue(amountMinInput, 350);
  const debouncedAmountMaxInput = useDebouncedValue(amountMaxInput, 350);
  const queryClient = useQueryClient();

  const { start: pastRangeStart, end: pastRangeEnd } = useMemo(
    () => pastTransactionsRange(timeFilter),
    [timeFilter]
  );
  const { data: reconcileSetupData, isFetching: reconcileSetupFetching } = useQuery({
    queryKey: ["reconcile-setup", accountId, "transactions-ledger"],
    queryFn: () => getReconcileSetup(accountId as number),
    enabled: typeof accountId === "number",
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  const pastTransactionsDateAfter = useMemo(
    () =>
      ledgerPastTransactionStart(timeFilter, hideReconciledPast, {
        min_start_date: reconcileSetupData?.min_start_date,
        last_reconcile_period_end: reconcileSetupData?.last_reconcile_period_end,
      }),
    [
      timeFilter,
      hideReconciledPast,
      reconcileSetupData?.min_start_date,
      reconcileSetupData?.last_reconcile_period_end,
    ]
  );
  /**
   * Server-side lower bound for Recent listTransactions.
   * show_reconciled → pastRangeStart (same as ledgerPastTransactionStart when reconciled visible).
   * hide reconciled → ledgerPastTransactionStart with reconcile checkpoint metadata so the API
   * skips pre-checkpoint unreconciled rows already represented in last_reconciled_balance.
   * pastRangeStart alone is wrong after reconcile — it would over-fetch rows the ledger discards.
   */
  const historyDateAfter = pastTransactionsDateAfter;
  const upcomingRange = useMemo(
    () => ledgerProjectionRange(todayStr(), forecastRange),
    [forecastRange]
  );
  /** Household / selected-account projection window — not History Range. */
  const hintLedgerRange = upcomingRange;

  const {
    data: txnsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      "transactions",
      {
        account: accountId || undefined,
        category: hasUrlCategory ? urlCategoryId : undefined,
        date_after: historyDateAfter,
        date_before: pastRangeEnd,
        showReconciled,
        ...(showReconciled
          ? { historyRange: timeFilter, include_reconciled_after: pastRangeStart }
          : {}),
      },
    ],
    queryFn: ({ pageParam = 1 }) =>
      listTransactions({
        ...(accountId
          ? {
              account: accountId as number,
              date_after: historyDateAfter,
              date_before: pastRangeEnd,
              page: pageParam,
              page_size: WEB_LEDGER_PAGE_SIZE,
              ordering: "date,id",
              include_running_balance: true,
              ...(hasUrlCategory ? { category: urlCategoryId } : {}),
              ...(showReconciled
                ? {
                    show_reconciled: true,
                    include_reconciled_after: pastRangeStart,
                  }
                : { reconciled: false }),
            }
          : {}),
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.next ? lastPageParam + 1 : undefined,
    enabled:
      typeof accountId === "number" &&
      !!pastRangeEnd &&
      (!hideReconciledPast || !reconcileSetupFetching),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const {
    data: ledgerTimelineData,
    isFetching: ledgerTimelineFetching,
    isError: ledgerTimelineError,
  } = useQuery({
    queryKey: [
      "timeline",
      "ledger",
      upcomingRange.start,
      upcomingRange.end,
      forecastRange,
      accountId,
      todayStr(),
      hideReconciledPast,
    ],
    queryFn: () =>
      getTimeline({
        start: upcomingRange.start,
        end: upcomingRange.end,
        as_of: todayStr(),
        account_id: typeof accountId === "number" ? accountId : undefined,
        exclude_reconciled_past: hideReconciledPast,
      }),
    enabled: typeof accountId === "number" && forecastReady,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: keepPreviousData,
  });
  const { data: accountData, isFetching: accountFetching } = useQuery({
    queryKey: ["account", accountId, "transactions-page", "light"],
    queryFn: () => getAccount(accountId as number, true),
    enabled: !!accountId,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });
  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "transactions-picker"],
    queryFn: () => listAccounts({ active_only: true, page_size: 500 }),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });
  const accounts = useMemo(() => {
    const rows = accountsData?.results ?? [];
    return rows.filter((a) => accountLifecycleStatus(a) === "active");
  }, [accountsData?.results]);

  const categoryHouseholdId = useMemo(() => {
    if (typeof accountId !== "number") return null;
    const fromAccount = accountData?.household;
    if (typeof fromAccount === "object" && fromAccount != null && "id" in fromAccount) {
      return (fromAccount as { id: number }).id;
    }
    if (typeof fromAccount === "number") return fromAccount;
    const fromList = accounts.find((a) => a.id === accountId);
    const h = fromList?.household;
    if (typeof h === "object" && h != null && "id" in h) return (h as { id: number }).id;
    if (typeof h === "number") return h;
    return null;
  }, [accountId, accountData?.household, accounts]);

  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "transactions", categoryHouseholdId ?? "all"],
    queryFn: () =>
      listCategories({
        page_size: 500,
        ...(categoryHouseholdId ? { household: categoryHouseholdId } : {}),
      }),
    enabled: !!accountId,
    staleTime: 15 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const ledgerReady =
    typeof accountId === "number" &&
    accountData != null &&
    !ledgerTimelineFetching &&
    (ledgerTimelineData != null || ledgerTimelineError);

  /** Heavy forecast/health — only after the ledger is on screen (first load + account swaps). */
  const { data: accountForecastData, isPending: accountForecastPending } = useQuery({
    queryKey: ["account", accountId, "transactions-page", "forecast-summary", forecastDays],
    queryFn: () =>
      getAccount(accountId as number, true, {
        forecast_summary: true,
        health: true,
        days: forecastDays,
      }),
    enabled: ledgerReady && forecastReady,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
  });

  usePerfPageLoad("transactions", ledgerReady, {
    account_id: accountId || "",
    past_start: historyDateAfter,
    past_end: pastRangeEnd,
    projection_start: upcomingRange.start,
    upcoming_end: upcomingRange.end,
  });

  const transactions = useMemo(
    () => txnsData?.pages.flatMap((p) => p.results) ?? [],
    [txnsData?.pages]
  );

  const historyPagesComplete = !hasNextPage;
  const account = useMemo(() => {
    if (!accountData) return undefined;
    if (
      !accountForecastData ||
      Number(accountForecastData.id) !== Number(accountData.id)
    ) {
      return accountData;
    }
    return { ...accountData, ...accountForecastData };
  }, [accountData, accountForecastData]);
  const accountMatchesSelection =
    typeof accountId === "number" &&
    account != null &&
    Number(account.id) === Number(accountId);
  const forecastSummaryReady =
    !accountForecastPending &&
    accountForecastData != null &&
    Number(accountForecastData.id) === Number(accountId);

  const householdId =
    account && typeof account.household === "object" && account.household != null && "id" in account.household
      ? (account.household as { id: number }).id
      : typeof account?.household === "number"
        ? account.household
        : categoryHouseholdId;

  const needsTransferHints =
    Boolean(inlineRow.transfer_to_account_id) || Boolean(editing);

  useEffect(() => {
    if (typeof accountId !== "number") return;
    logTransactionsPageLoadPlan({
      accountId,
      pastRange: { start: pastRangeStart, end: pastRangeEnd },
      upcomingRange,
      forecastRange,
      hideReconciledPast,
      householdTimelineEnabled: needsTransferHints && householdId != null,
      duplicateAccountCallsRemoved: true,
      forecastSummaryDeferred: true,
    });
  }, [
    accountId,
    pastRangeStart,
    pastRangeEnd,
    upcomingRange,
    forecastRange,
    hideReconciledPast,
    needsTransferHints,
    householdId,
  ]);

  useEffect(() => {
    saveStoredTransactionsAccountId(accountId);
  }, [accountId]);

  useEffect(() => {
    saveStoredTransactionsTimeFilter(timeFilter);
  }, [timeFilter]);

  useEffect(() => {
    setSelectedTransactionIds(new Set());
  }, [accountId]);

  useEffect(() => {
    saveStoredTransactionsAmountRange(amountMinInput, amountMaxInput);
  }, [amountMinInput, amountMaxInput]);

  useEffect(() => {
    consumedNavAccountRef.current = false;
    hasSetInitialAccount.current = false;
  }, [location.key]);

  useEffect(() => {
    if (accountId !== "" && !accounts.some((a) => a.id === accountId)) {
      setAccountId("");
      hasSetInitialAccount.current = false;
    }
  }, [accountId, accounts]);

  useEffect(() => {
    if (accounts.length === 0) return;
    if (navState?.accountId != null && !consumedNavAccountRef.current) {
      const navId = Number(navState.accountId);
      if (accounts.some((a) => a.id === navId)) {
        setAccountId(navId);
        consumedNavAccountRef.current = true;
        hasSetInitialAccount.current = true;
        if (navState.focus === "view_upcoming" || urlFocus === "upcoming") {
          setForecastExpanded(true);
          setPastExpanded(false);
        }
      }
      return;
    }
    if (hasUrlAccount && !consumedNavAccountRef.current) {
      if (accounts.some((a) => a.id === urlAccountId)) {
        setAccountId(urlAccountId);
        consumedNavAccountRef.current = true;
        hasSetInitialAccount.current = true;
        if (urlFocus === "upcoming") {
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
  }, [profile?.default_account, navState?.accountId, navState?.focus, accounts, hasUrlAccount, urlAccountId, urlFocus]);

  useEffect(() => {
    if (hasAppliedBillPrefill.current || accountId === "") return;
    const urlAdd = searchParams.get("add") === "1";
    if (!navState?.prefillDate && !navState?.prefillPayee && !(urlAdd && urlDate)) return;
    const amtRaw = navState?.prefillAmount ? parseFloat(navState.prefillAmount) : NaN;
    const outflowAmt = Number.isFinite(amtRaw) ? String(-Math.abs(amtRaw)) : "";
    setInlineRow((row) => ({
      ...row,
      date: navState?.prefillDate ?? urlDate ?? row.date,
      payee: navState?.prefillPayee ?? row.payee,
      amount: outflowAmt || row.amount,
      direction: "OUTFLOW",
    }));
    const due = navState?.prefillDate ?? urlDate ?? todayStr();
    if (due > todayStr()) {
      setForecastExpanded(true);
      setPastExpanded(false);
    } else {
      setPastExpanded(true);
    }
    hasAppliedBillPrefill.current = true;
  }, [accountId, navState?.prefillDate, navState?.prefillPayee, navState?.prefillAmount, urlDate, searchParams]);

  const categories = categoriesData?.results ?? [];
  const categoryDropdownOptions = useMemo(
    () => categoriesForDropdown(categories),
    [categories]
  );

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

  const { data: householdTimelineData, isFetching: householdTimelineFetching } = useQuery({
    queryKey: [
      "timeline",
      "household",
      upcomingRange.start,
      upcomingRange.end,
      forecastRange,
      householdId,
      todayStr(),
    ],
    queryFn: () =>
      getTimeline({
        start: upcomingRange.start,
        end: upcomingRange.end,
        as_of: todayStr(),
        household_id: householdId ?? undefined,
      }),
    enabled: !!householdId && needsTransferHints,
    staleTime: 120_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

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

  /** Same timeline the card’s Transactions page uses. */
  const inlineCardTimelineFromLedger = useMemo(() => {
    if (
      inlinePayToCardAccountId == null ||
      typeof accountId !== "number" ||
      Number(accountId) !== Number(inlinePayToCardAccountId) ||
      ledgerTimelineData?.timeline == null
    ) {
      return null;
    }
    return ledgerTimelineData.timeline.filter(
      (r) => Number(r.account_id) === Number(inlinePayToCardAccountId)
    );
  }, [inlinePayToCardAccountId, accountId, ledgerTimelineData?.timeline]);

  const inlineCardCanUseLedger =
    inlineCardTimelineFromLedger != null &&
    (inlineRow.date === "" || inlineRow.date >= upcomingRange.start);

  const inlineCardNeedsDedicatedTimeline =
    inlinePayToCardAccountId != null &&
    inlineProjectionRange != null &&
    !inlineCardCanUseLedger;

  const { data: inlineCardTimelineData, isFetching: inlineCardTimelineLoading } = useQuery({
    queryKey: [
      "timeline",
      "card-balance-hint",
      inlinePayToCardAccountId,
      inlineProjectionRange?.start,
      inlineProjectionRange?.end,
      inlineProjectionRange?.as_of,
      hideReconciledPast,
    ],
    queryFn: () => {
      const range = inlineProjectionRange!;
      return getTimeline({
        start: range.start,
        end: range.end,
        as_of: range.as_of,
        account_id: inlinePayToCardAccountId!,
        exclude_reconciled_past: hideReconciledPast,
      });
    },
    enabled: inlineCardNeedsDedicatedTimeline,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const inlineCardTimelineForHint = inlineCardCanUseLedger
    ? inlineCardTimelineFromLedger ?? []
    : inlineCardTimelineData?.timeline ?? [];

  const inlineCardTimelineLoadingResolved =
    inlineCardNeedsDedicatedTimeline &&
    inlineCardTimelineLoading &&
    inlineCardTimelineFromLedger == null;

  const inlineOwedAsOfPaymentDate = useMemo(() => {
    if (inlinePayToCardAccountId == null || !inlineRow.date) return null;
    const cardAccount = accounts.find((a) => a.id === inlinePayToCardAccountId);
    const openingSigned = cardAccount
      ? creditSignedOpeningBalance(cardAccount.starting_balance)
      : null;
    return creditOwedAsOfDateFromTimeline(
      inlineCardTimelineForHint,
      inlinePayToCardAccountId,
      inlineRow.date,
      new Set(),
      openingSigned
    );
  }, [inlinePayToCardAccountId, inlineRow.date, inlineCardTimelineForHint, accounts]);

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

  const inlineBankHintInLedgerRange =
    inlineBankTransferDestId != null &&
    inlineRow.date !== "" &&
    hintDateWithinLedgerRange(inlineRow.date, hintLedgerRange) &&
    householdTimelineData != null;

  const inlineBankNeedsDedicatedTimeline =
    inlineBankTransferDestId != null &&
    inlineProjectionRange != null &&
    !inlineBankHintInLedgerRange;

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
    enabled: inlineBankNeedsDedicatedTimeline,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const inlineBankTimelineForHint = useMemo(
    () =>
      pickAccountTimelineForHint(
        inlineBankTransferDestId ?? 0,
        inlineRow.date,
        hintLedgerRange,
        householdTimelineData?.timeline,
        inlineBankDestTimelineData?.timeline
      ),
    [
      inlineBankTransferDestId,
      inlineRow.date,
      hintLedgerRange,
      householdTimelineData?.timeline,
      inlineBankDestTimelineData?.timeline,
    ]
  );

  const inlineBankDestTimelineLoadingResolved =
    inlineBankHintInLedgerRange && householdTimelineFetching
      ? true
      : inlineBankNeedsDedicatedTimeline && inlineBankDestTimelineLoading;

  const inlineBankDestBalanceBefore = useMemo(() => {
    if (inlineBankTransferDestId == null || !inlineRow.date) return null;
    return assetBalanceAsOfDateFromTimeline(
      inlineBankTimelineForHint,
      inlineBankTransferDestId,
      inlineRow.date,
      new Set()
    );
  }, [inlineBankTransferDestId, inlineRow.date, inlineBankTimelineForHint]);

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
  const editHasLinkedTransferLeg =
    Boolean(editing) &&
    (editing as { linked_transaction_id?: number | null }).linked_transaction_id != null;
  const editIsTransferInflowLeg =
    editForm.direction === "INFLOW" &&
    Boolean(editing && (editHasLinkedTransferLeg || editIsLinkedTransfer));
  /** Orphan card payment (no bank leg linked yet) — user must pick Paid from. */
  const editIsOrphanCcPaymentInflow =
    editIsCreditCardInflow &&
    editCategory?.name === "Credit Card Payment" &&
    !editHasLinkedTransferLeg;
  /** “Payment to” only on outflow; linked card inflows show static Paid from; orphans get a Paid from selector. */
  const hideEditTransferToSelector =
    editIsCreditCardInflow &&
    editHasLinkedTransferLeg &&
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
    if (editIsOrphanCcPaymentInflow) {
      // Paying account for a card payment — bank/cash, not another credit card.
      return accounts.filter(
        (a) =>
          a.id !== fromAccountId &&
          a.household?.id === sameHousehold &&
          String(a.account_type ?? "").toUpperCase() !== "CREDIT"
      );
    }
    const creditOnly = editCategory?.name === "Credit Card Payment";
    return accounts.filter(
      (a) =>
        a.id !== fromAccountId &&
        a.household?.id === sameHousehold &&
        (creditOnly ? a.account_type === "CREDIT" : true)
    );
  }, [
    editing,
    account,
    accounts,
    editForm.account_id,
    editForm.category_id,
    editCategory?.name,
    editIsOrphanCcPaymentInflow,
  ]);
  const showEditPaidFromSelector =
    Boolean(editing) &&
    editIsOrphanCcPaymentInflow &&
    editTransferToAccounts.length > 0;
  const showEditTransferToSelector =
    Boolean(editing) &&
    editForm.direction === "OUTFLOW" &&
    editTransferToAccounts.length > 0 &&
    (editIsLinkedTransfer || editIsTransferCategoryName(editCategory?.name)) &&
    !hideEditTransferToSelector &&
    !editIsOrphanCcPaymentInflow;
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

  const editTransferCounterpartyId = editBankTransferDestId ?? editPayToCardId;

  const editTransferFromId = useMemo(() => {
    if (typeof accountId !== "number" || editTransferCounterpartyId == null) return null;
    return editForm.direction === "OUTFLOW" ? accountId : editTransferCounterpartyId;
  }, [accountId, editTransferCounterpartyId, editForm.direction]);

  const editTransferToId = useMemo(() => {
    if (typeof accountId !== "number" || editTransferCounterpartyId == null) return null;
    return editForm.direction === "OUTFLOW" ? editTransferCounterpartyId : accountId;
  }, [accountId, editTransferCounterpartyId, editForm.direction]);

  const editTransferPreview = useTransferBalancePreview({
    fromAccountId: editTransferFromId,
    toAccountId: editTransferToId,
    amount: editForm.amount,
    date: editForm.date,
    excludeTransactionIds: [...editExcludeTxnIds],
    enabled: Boolean(editing && editTransferCounterpartyId != null),
  });

  const editProjectionRange = useMemo(
    () => (debouncedEditDate ? projectionTimelineRangeForAsOf(debouncedEditDate) : null),
    [debouncedEditDate]
  );

  /** Same timeline the card’s Transactions page uses — never the household upcoming-only feed. */
  const editCardTimelineFromLedger = useMemo(() => {
    if (
      editPayToCardId == null ||
      typeof accountId !== "number" ||
      Number(accountId) !== Number(editPayToCardId) ||
      ledgerTimelineData?.timeline == null
    ) {
      return null;
    }
    return ledgerTimelineData.timeline.filter((r) => Number(r.account_id) === Number(editPayToCardId));
  }, [editPayToCardId, accountId, ledgerTimelineData?.timeline]);

  const editCardCanUseLedger =
    editCardTimelineFromLedger != null &&
    (editForm.date === "" || editForm.date >= upcomingRange.start);

  const editCardNeedsDedicatedTimeline =
    editPayToCardId != null && editProjectionRange != null && !editCardCanUseLedger;

  const { data: editCardTimelineData, isFetching: editCardTimelineLoading } = useQuery({
    queryKey: [
      "timeline",
      "card-balance-hint",
      editPayToCardId,
      editProjectionRange?.start,
      editProjectionRange?.end,
      editProjectionRange?.as_of,
      hideReconciledPast,
    ],
    queryFn: () => {
      const range = editProjectionRange!;
      return getTimeline({
        start: range.start,
        end: range.end,
        as_of: range.as_of,
        account_id: editPayToCardId!,
        exclude_reconciled_past: hideReconciledPast,
      });
    },
    enabled: editCardNeedsDedicatedTimeline,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const editCardTimelineForHint = editCardCanUseLedger
    ? editCardTimelineFromLedger ?? []
    : editCardTimelineData?.timeline ?? [];

  const editCardTimelineLoadingResolved =
    editCardNeedsDedicatedTimeline && editCardTimelineLoading && editCardTimelineFromLedger == null;

  /** Debt on the card as of the payment date, excluding this transfer (canonical preview). */
  const editOwedAsOfPaymentDate = editTransferPreview.data?.destination_balance_owed_before ?? null;

  const editBankHintInLedgerRange =
    editBankTransferDestId != null &&
    editForm.date !== "" &&
    hintDateWithinLedgerRange(editForm.date, hintLedgerRange) &&
    householdTimelineData != null;

  const editBankNeedsDedicatedTimeline =
    editBankTransferDestId != null && editProjectionRange != null && !editBankHintInLedgerRange;

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
    enabled: editBankNeedsDedicatedTimeline,
    staleTime: 300_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const editBankTimelineForHint = useMemo(
    () =>
      pickAccountTimelineForHint(
        editBankTransferDestId ?? 0,
        editForm.date,
        hintLedgerRange,
        householdTimelineData?.timeline,
        editBankDestTimelineData?.timeline
      ),
    [
      editBankTransferDestId,
      editForm.date,
      hintLedgerRange,
      householdTimelineData?.timeline,
      editBankDestTimelineData?.timeline,
    ]
  );

  const editBankDestTimelineLoadingResolved =
    editBankHintInLedgerRange && householdTimelineFetching
      ? true
      : editBankNeedsDedicatedTimeline && editBankDestTimelineLoading;

  const editBankDestBalanceExcludingTransfer =
    editTransferPreview.data?.destination_balance_before ?? null;

  const editBankDestBalanceAfterTransfer =
    editTransferPreview.data?.destination_balance_after ?? null;

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

  const plaidHouseholdId = householdId ?? profile?.default_household ?? null;

  const [awaitingTimelineRecalc, setAwaitingTimelineRecalc] = useState(false);
  const [occurrenceResolving, setOccurrenceResolving] = useState(false);

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

  const today = todayStr();
  const householdTimelineByAccount = useMemo(
    () => indexTimelineRowsByAccount(householdTimelineData?.timeline),
    [householdTimelineData?.timeline]
  );
  const ledgerTimelineByAccount = useMemo(
    () => indexTimelineRowsByAccount(ledgerTimelineData?.timeline),
    [ledgerTimelineData?.timeline]
  );

  /** For each non-credit account: first date on or after today when balance goes negative (if any). */
  const negativeBalanceWarnings = useMemo(() => {
    const nonCredit = accountsForHousehold.filter((a) => String((a.account_type ?? "").toUpperCase()) !== "CREDIT");
    const warnings: { accountName: string; date: string }[] = [];
    for (const acc of nonCredit) {
      const futureRows = (householdTimelineByAccount.get(Number(acc.id)) ?? [])
        .filter((r) => r.date >= today)
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
  }, [householdTimelineByAccount, accountsForHousehold, today]);

  /** For each credit account with a limit: first date on or after today when balance goes over the credit limit (debt exceeds limit). */
  const creditLimitWarnings = useMemo(() => {
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
      const futureRows = (householdTimelineByAccount.get(Number(acc.id)) ?? [])
        .filter((r) => r.date >= today)
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
  }, [householdTimelineByAccount, accountsForHousehold, today]);

  const ledgerRows = useMemo(() => {
    if (!account || typeof accountId !== "number" || !accountMatchesSelection) return [];
    const today = todayStr();
    const openingBalance = ledgerOpeningBalance(account.starting_balance, isCreditAccount);
    const pastOpeningOverrideRaw =
      ledgerTimelineData?.past_opening_balance != null
        ? parseFloat(ledgerTimelineData.past_opening_balance)
        : reconcileSetupData?.last_reconciled_balance != null
          ? parseFloat(reconcileSetupData.last_reconciled_balance)
          : null;
    const pastOpeningOverride = hideReconciledOpeningBalance(
      pastOpeningOverrideRaw,
      isCreditAccount
    );
    const hasPastOpeningOverride =
      pastOpeningOverride != null && Number.isFinite(pastOpeningOverride);
    const apiBalance = accountLedgerDisplayBalance(account, isCreditAccount);

    if (hideReconciledPast && !hasPastOpeningOverride) {
      if (reconcileSetupFetching || ledgerTimelineFetching) {
        return [];
      }
    }

    const pastTxns = showReconciled
      ? transactions
      : transactions.filter((t) => !t.reconciled);
    const timelineForAccount = ledgerTimelineByAccount.get(Number(accountId)) ?? [];

    if (ledgerTimelineError && pastTxns.length === 0) {
      return buildLedgerRows(
        pastTxns,
        hasPastOpeningOverride ? pastOpeningOverride! : openingBalance,
        account.currency,
        isCreditAccount,
        apiBalance
      );
    }

    return buildLedgerRowsFromPastAndUpcomingTimeline(
      pastTxns,
      timelineForAccount,
      today,
      openingBalance,
      isCreditAccount,
      {
        // Open at last checkpoint for both modes. Hide-reconciled omits sealed rows;
        // show-reconciled keeps them with Balance "—" (no replay of sealed amounts).
        pastOpeningOverride: hasPastOpeningOverride ? pastOpeningOverride : null,
        lastReconcilePeriodEnd: hideReconciledPast
          ? reconcileSetupData?.last_reconcile_period_end ?? null
          : null,
        reconcileFloor: hideReconciledPast
          ? reconcileSetupData?.min_start_date ?? null
          : null,
        checkpointPeriodEnd: hasPastOpeningOverride
          ? reconcileSetupData?.last_reconcile_period_end ?? null
          : null,
      }
    );
  }, [
    account,
    accountId,
    accountMatchesSelection,
    transactions,
    ledgerTimelineByAccount,
    ledgerTimelineData,
    ledgerTimelineData?.timeline,
    ledgerTimelineData?.past_opening_balance,
    ledgerTimelineError,
    isCreditAccount,
    hideReconciledPast,
    showReconciled,
    reconcileSetupData?.last_reconciled_balance,
    reconcileSetupData?.last_reconcile_period_end,
    reconcileSetupData?.min_start_date,
    reconcileSetupFetching,
    ledgerTimelineFetching,
  ]);

  const accountTimeline = useMemo(() => {
    if (typeof accountId !== "number") return [];
    return ledgerTimelineByAccount.get(Number(accountId)) ?? [];
  }, [accountId, ledgerTimelineByAccount]);

  /** Split into: start, past, pending expected, today, future. */
  const ledgerSections = useMemo(() => splitLedgerSections(ledgerRows), [ledgerRows]);

  /** Must match Pending Transactions section ending balance — see pendingSectionEndingBalance. */
  const ledgerCurrentBalance = useMemo(() => {
    const pendingEnding = pendingSectionEndingBalance(ledgerRows);
    if (pendingEnding != null) return pendingEnding;
    if (!historyPagesComplete) return null;
    return currentBalanceFromLedgerSections(ledgerSections);
  }, [ledgerRows, ledgerSections, historyPagesComplete]);

  const ledgerForecastRows = useMemo(
    () => [...ledgerSections.pending, ...ledgerSections.future],
    [ledgerSections.pending, ledgerSections.future]
  );

  const ledgerLowestProjected = useMemo(
    () => lowestProjectedFromLedgerFuture(ledgerForecastRows),
    [ledgerForecastRows]
  );

  const ledgerFirstNegative = useMemo(
    () => firstNegativeFromLedgerFuture(ledgerForecastRows),
    [ledgerForecastRows]
  );

  const pastRowFilters = useMemo(
    () => ({
      amountMin: parseAmountFilterInput(debouncedAmountMinInput),
      amountMax: parseAmountFilterInput(debouncedAmountMaxInput),
    }),
    [debouncedAmountMinInput, debouncedAmountMaxInput]
  );

  const filteredPastRows = useMemo(
    () => filterLedgerPastRows(ledgerSections.past, pastRowFilters),
    [ledgerSections.past, pastRowFilters]
  );
  const filteredPendingRows = useMemo(
    () => filterLedgerRows(ledgerSections.pending, pastRowFilters),
    [ledgerSections.pending, pastRowFilters]
  );
  const filteredFutureRows = useMemo(
    () => filterLedgerRows(ledgerSections.future, pastRowFilters),
    [ledgerSections.future, pastRowFilters]
  );

  const pastFiltersActive = hasActiveLedgerRowFilters(pastRowFilters);

  const resetInlineRow = () => {
    setInlineRow({
      date: todayStr(),
      payee: "",
      category_id: "",
      transfer_to_account_id: "",
      amount: "",
      direction: "OUTFLOW",
    });
  };

  const transactionsQueryKey = useMemo(
    () =>
      [
        "transactions",
        {
          account: accountId || undefined,
          category: hasUrlCategory ? urlCategoryId : undefined,
          date_after: historyDateAfter,
          date_before: pastRangeEnd,
          showReconciled,
          ...(showReconciled
            ? { historyRange: timeFilter, include_reconciled_after: pastRangeStart }
            : {}),
        },
      ] as const,
    [
      accountId,
      hasUrlCategory,
      urlCategoryId,
      historyDateAfter,
      pastRangeEnd,
      pastRangeStart,
      showReconciled,
      timeFilter,
    ]
  );

  function afterFinancialEdit(
    opts?: Parameters<typeof refreshAfterTransactionEdit>[1]
  ) {
    setAwaitingTimelineRecalc(true);
    refreshAfterTransactionEdit(queryClient, opts);
  }

  const createMu = useMutation({
    mutationFn: createTransaction,
    onSuccess: () => {
      afterFinancialEdit({ refreshAccounts: true });
    },
  });

  const createTransferMu = useMutation({
    mutationFn: (body: Parameters<typeof createTransfer>[0]) => createTransfer(body),
    onSuccess: (_data, variables) => {
      afterFinancialEdit({ refreshAccounts: true });
      void queryClient.refetchQueries({ queryKey: ["account", variables.from_account], type: "active" });
      void queryClient.refetchQueries({ queryKey: ["account", variables.to_account], type: "active" });
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
      setAwaitingTimelineRecalc(true);

      await queryClient.cancelQueries({ queryKey: transactionsQueryKey });
      const previousTxns = queryClient.getQueryData(transactionsQueryKey);
      queryClient.setQueryData(
        transactionsQueryKey,
        (old: { pages?: { results?: Transaction[] }[] } | undefined) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              results: (page.results ?? []).map((t) =>
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
            })),
          };
        }
      );
      return { ...snapshot, previousTxns, transactionsQueryKey };
    },
    onError: (err: Error, _vars, context) => {
      setAwaitingTimelineRecalc(false);
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
      const newAccountId = variables.data.account_id;
      const syncedToAccountId = (updatedTxn as { synced_to_account_id?: number }).synced_to_account_id;
      const affectsBalances =
        variables.data.amount != null ||
        variables.data.date != null ||
        variables.data.account_id != null;
      afterFinancialEdit({
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
    onMutate: () => {
      setAwaitingTimelineRecalc(true);
    },
    onSuccess: () => {
      setDeleteError(null);
      afterFinancialEdit({ refreshAccounts: true });
    },
    onError: (err: Error) => {
      setAwaitingTimelineRecalc(false);
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setDeleteError(msg || "Failed to delete transaction");
    },
  });

  const batchDeleteMu = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(ids.map((id) => deleteTransaction(id)));
      const failed = results.filter((r) => r.status === "rejected").length;
      const deleted = ids.length - failed;
      return { deleted, failed, total: ids.length };
    },
    onMutate: () => {
      setAwaitingTimelineRecalc(true);
    },
    onSuccess: (result) => {
      setSelectedTransactionIds(new Set());
      if (result.failed > 0) {
        setDeleteError(
          `Deleted ${result.deleted} of ${result.total}; ${result.failed} could not be deleted (reconciled or locked).`
        );
      } else {
        setDeleteError(null);
      }
      afterFinancialEdit({ refreshAccounts: true });
    },
    onError: (err: Error) => {
      setAwaitingTimelineRecalc(false);
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setDeleteError(msg || "Failed to delete selected transactions");
    },
  });

  const skipOccurrenceMu = useMutation({
    mutationFn: skipTransactionOccurrence,
    onMutate: () => {
      setAwaitingTimelineRecalc(true);
    },
    onSuccess: () => {
      setDeleteError(null);
      afterFinancialEdit({ refreshAccounts: true });
    },
    onError: (err: Error) => {
      setAwaitingTimelineRecalc(false);
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setDeleteError(msg || "Failed to skip transaction");
    },
  });

  const moveDateMu = useMutation({
    mutationFn: ({ id, date }: { id: number; date: string }) => moveTransactionDate(id, date),
    onMutate: () => {
      setAwaitingTimelineRecalc(true);
    },
    onSuccess: () => {
      setDeleteError(null);
      afterFinancialEdit({ refreshAccounts: true });
    },
    onError: (err: Error) => {
      setAwaitingTimelineRecalc(false);
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setDeleteError(msg || "Failed to move transaction date");
    },
  });

  const lifecyclePending =
    skipOccurrenceMu.isPending ||
    moveDateMu.isPending ||
    deleteMu.isPending ||
    batchDeleteMu.isPending;

  const balanceAffectingMutationPending =
    updateMu.isPending ||
    createMu.isPending ||
    createTransferMu.isPending ||
    deleteMu.isPending ||
    batchDeleteMu.isPending ||
    skipOccurrenceMu.isPending ||
    moveDateMu.isPending;

  useEffect(() => {
    if (
      awaitingTimelineRecalc &&
      !ledgerTimelineFetching &&
      !balanceAffectingMutationPending &&
      !occurrenceResolving
    ) {
      setAwaitingTimelineRecalc(false);
    }
  }, [
    awaitingTimelineRecalc,
    ledgerTimelineFetching,
    balanceAffectingMutationPending,
    occurrenceResolving,
  ]);

  const balancesRecalculating =
    awaitingTimelineRecalc &&
    (balanceAffectingMutationPending || ledgerTimelineFetching || occurrenceResolving);

  const forecastActionsLocked =
    balancesRecalculating || occurrenceResolving || lifecyclePending;

  const forecastRangeLoading =
    ledgerTimelineFetching &&
    !balancesRecalculating &&
    (forecastRange === "90d" || forecastRange === "6m");

  const editingImported = editing ? isBankImportedTransaction(editing) : false;
  const editingReconciled = Boolean(editing?.reconciled);
  const editingFinancialLocked = editingImported || editingReconciled;
  const editingPayeeLocked = editingReconciled;
  const editingLockMessage = editing
    ? transactionEditLockMessage(
        editing,
        (editing.account as { name?: string } | undefined)?.name ??
          accounts.find(
            (a) => a.id === (editing.account_id ?? (editing.account as { id?: number })?.id)
          )?.name
      )
    : null;

  function openEdit(txn: Transaction, opts?: { ledgerFlow?: "INFLOW" | "OUTFLOW" }) {
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
      direction:
        opts?.ledgerFlow ?? (amt >= 0 ? "INFLOW" : "OUTFLOW"),
      transfer_to_account_id: transferToId,
    });
  }

  async function openEditByTimelineId(
    transactionId: number,
    opts?: { ledgerFlow?: "INFLOW" | "OUTFLOW" }
  ) {
    try {
      setDeleteError(null);
      const txn = await getTransaction(transactionId);
      openEdit(txn, opts);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not load transaction for edit");
    }
  }

  async function resolveTimelineRowTransactionId(row: TimelineRow): Promise<number | null> {
    if (row.transaction_id != null) return row.transaction_id;
    if (row.rule_id == null) return null;
    const rowAccountId = Number(row.account_id);
    if (!Number.isFinite(rowAccountId)) return null;

    const resolved = await resolveRuleOccurrence({
      rule_id: row.rule_id,
      account_id: rowAccountId,
      occurrence_date: row.date,
    });
    return resolved.transaction_id ?? null;
  }

  async function ensureRowTransactionId(row: TimelineRow): Promise<number | null> {
    if (row.transaction_id != null) return row.transaction_id;
    if (forecastActionsLocked) return null;

    setOccurrenceResolving(true);
    setAwaitingTimelineRecalc(true);
    try {
      const transactionId = await resolveTimelineRowTransactionId(row);
      if (transactionId != null) {
        await queryClient.cancelQueries({ queryKey: ["timeline"] });
        await queryClient.refetchQueries({ queryKey: ["timeline"], type: "active" });
      }
      return transactionId;
    } catch (err) {
      setAwaitingTimelineRecalc(false);
      throw err;
    } finally {
      setOccurrenceResolving(false);
    }
  }

  async function openEditByLedgerRow(row: TimelineRow) {
    if (row.source === "interest") return;
    try {
      setDeleteError(null);
      const transactionId =
        row.transaction_id ?? (await ensureRowTransactionId(row));
      if (transactionId == null) {
        setDeleteError("Could not load this scheduled transaction for editing.");
        return;
      }
      await openEditByTimelineId(transactionId, {
        ledgerFlow: timelineRowFlowDirection(row) ?? undefined,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not load transaction for edit");
    }
  }

  async function confirmDeleteRow(row: TimelineRow) {
    if (row.reconciled) {
      setDeleteError("Reconciled transactions cannot be deleted.");
      return;
    }
    if (isBankImportedTransaction({
      plaid_transaction_id: row.plaid_transaction_id,
      source: row.txn_source ?? row.source,
    })) {
      setDeleteError("Imported bank transactions cannot be deleted.");
      return;
    }
    setDeleteError(null);
    try {
      const transactionId =
        row.transaction_id ?? (await ensureRowTransactionId(row));
      if (transactionId == null) {
        setDeleteError("Could not load this scheduled transaction for deletion.");
        return;
      }
      confirmDelete(transactionId, row.description);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not delete transaction");
    }
  }

  async function confirmSkipRow(row: TimelineRow) {
    if (row.reconciled) {
      setDeleteError("Reconciled transactions cannot be skipped.");
      return;
    }
    setDeleteError(null);
    try {
      const transactionId =
        row.transaction_id ?? (await ensureRowTransactionId(row));
      if (transactionId == null) {
        setDeleteError("Could not load this scheduled transaction to skip.");
        return;
      }
      confirmSkipOccurrence(transactionId, row.description);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not skip transaction");
    }
  }

  async function matchesImportedRow(row: TimelineRow) {
    if (row.reconciled) {
      setDeleteError("Reconciled transactions cannot be removed.");
      return;
    }
    setDeleteError(null);
    try {
      const transactionId =
        row.transaction_id ?? (await ensureRowTransactionId(row));
      if (transactionId == null) {
        setDeleteError("Could not load this scheduled transaction.");
        return;
      }
      skipOccurrenceMu.mutate(transactionId);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not remove scheduled transaction");
    }
  }

  async function moveDateExpectedRow(row: TimelineRow) {
    if (row.reconciled) {
      setDeleteError("Reconciled transactions cannot be moved.");
      return;
    }
    setDeleteError(null);
    try {
      const transactionId =
        row.transaction_id ?? (await ensureRowTransactionId(row));
      if (transactionId == null) {
        setDeleteError("Could not load this expected transaction to move.");
        return;
      }
      const input = window.prompt(
        `Move "${row.description}" to a new date (YYYY-MM-DD):`,
        row.date
      );
      if (input == null || !input.trim()) return;
      moveDateMu.mutate({ id: transactionId, date: input.trim() });
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not move transaction date");
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
    const isOrphanCcPaidFromSubmit =
      editSrcSubmit != null &&
      String(editSrcSubmit.account_type ?? "").toUpperCase() === "CREDIT" &&
      editForm.direction === "INFLOW" &&
      editCat?.name === "Credit Card Payment" &&
      (editing as { linked_transaction_id?: number | null }).linked_transaction_id == null &&
      typeof editForm.transfer_to_account_id === "number" &&
      editForm.transfer_to_account_id > 0;
    const omitTransferToOnSubmit =
      editForm.direction === "INFLOW" &&
      !isOrphanCcPaidFromSubmit &&
      (linkedTransfer || transferCategory);
    const includeTransferToOnSubmit =
      isOrphanCcPaidFromSubmit ||
      (!omitTransferToOnSubmit &&
        editForm.direction === "OUTFLOW" &&
        editForm.transfer_to_account_id &&
        (linkedTransfer || transferCategory));
    const imported = isBankImportedTransaction(editing);
    const reconciled = Boolean(editing.reconciled);
    const financialLocked = imported || reconciled;
    const metadataLocked = reconciled;
    const payload = {
      ...(metadataLocked ? {} : { payee: editForm.payee || "—" }),
      ...(metadataLocked ? {} : { category_id: editForm.category_id || null }),
      ...(financialLocked
        ? {}
        : {
            date: editForm.date,
            amount: String(signedAmount),
            ...(editForm.account_id ? { account_id: editForm.account_id as number } : {}),
            ...(includeTransferToOnSubmit
              ? { transfer_to_account_id: editForm.transfer_to_account_id as number }
              : {}),
          }),
    };
    if (Object.keys(payload).length === 0) return;
    if (applyToRule && editingRuleId != null && !financialLocked) {
      const ruleDirection =
        isOrphanCcPaidFromSubmit || includeTransferToOnSubmit
          ? "TRANSFER"
          : editForm.direction === "INFLOW"
            ? "INCOME"
            : "EXPENSE";
      try {
        await updateRule(editingRuleId, {
          name: editForm.payee || "—",
          amount: String(Math.abs(amt)),
          category_id: editForm.category_id || null,
          ...(isOrphanCcPaidFromSubmit
            ? {
                account_id: editForm.transfer_to_account_id as number,
                transfer_to_account_id: editAccountIdSubmit as number,
                direction: "TRANSFER" as const,
              }
            : {
                account_id: editForm.account_id ? (editForm.account_id as number) : undefined,
                direction: ruleDirection,
                ...(includeTransferToOnSubmit
                  ? { transfer_to_account_id: editForm.transfer_to_account_id as number }
                  : {}),
              }),
        });
        queryClient.invalidateQueries({ queryKey: ["rules"] });
        afterFinancialEdit({ refreshAccounts: true });
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Failed to update automation");
        return;
      }
    }
    updateMu.mutate({ id: editing.id, data: payload });
  }

  function handleInlineAdd(e?: React.FormEvent) {
    e?.preventDefault();
    if (
      inlineAddInFlight.current ||
      createMu.isPending ||
      createTransferMu.isPending
    ) {
      return;
    }

    const formSnapshot: InlineAddForm = { ...inlineRow };
    const signedAmt = parseFloat(formSnapshot.amount);
    if (
      !accountId ||
      !formSnapshot.amount.trim() ||
      signedAmt === 0 ||
      Number.isNaN(signedAmt)
    ) {
      return;
    }
    if (isTransferCategory && !formSnapshot.transfer_to_account_id) {
      return;
    }

    inlineAddInFlight.current = true;
    setDeleteError(null);
    resetInlineRow();

    const restoreInlineForm = () => setInlineRow(formSnapshot);
    const onAddError = (err: Error) => {
      restoreInlineForm();
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setDeleteError(msg || "Failed to add transaction");
    };
    const onAddSettled = () => {
      inlineAddInFlight.current = false;
    };

    if (isTransferCategory && formSnapshot.transfer_to_account_id) {
      const absAmt = Math.abs(signedAmt);
      const isOutflow = signedAmt < 0;
      createTransferMu.mutate(
        {
          from_account: (isOutflow ? accountId : formSnapshot.transfer_to_account_id) as number,
          to_account: (isOutflow ? formSnapshot.transfer_to_account_id : accountId) as number,
          amount: String(absAmt),
          date: formSnapshot.date,
          payee: formSnapshot.payee.trim(),
          from_category_id: formSnapshot.category_id ? formSnapshot.category_id : undefined,
        },
        { onError: onAddError, onSettled: onAddSettled }
      );
    } else {
      createMu.mutate(
        {
          account_id: accountId,
          date: formSnapshot.date,
          payee: formSnapshot.payee || "—",
          amount: String(signedAmt),
          category_id: formSnapshot.category_id || null,
          memo: "",
          ...(navState?.fromBillChecklist ? { is_bill: true } : {}),
        },
        { onError: onAddError, onSettled: onAddSettled }
      );
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

  function toggleSelectedTransaction(id: number, selected: boolean) {
    setSelectedTransactionIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setSelectedTransactionGroup(ids: number[], selected: boolean) {
    setSelectedTransactionIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function clearPendingSelectionKeys(keys: string[]) {
    if (keys.length === 0) return;
    setPendingSelectionKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
  }

  async function resolveRowDataTransactionId(row: TransactionRowData): Promise<number | null> {
    if (row.transactionId != null) return row.transactionId;
    if (row.source.rule_id == null || row.accountId == null) return null;
    if (forecastActionsLocked) return null;
    setOccurrenceResolving(true);
    setAwaitingTimelineRecalc(true);
    try {
      const resolved = await resolveRuleOccurrence({
        rule_id: row.source.rule_id,
        account_id: row.accountId,
        occurrence_date: row.date,
      });
      await queryClient.cancelQueries({ queryKey: ["timeline"] });
      await queryClient.refetchQueries({ queryKey: ["timeline"], type: "active" });
      return resolved.transaction_id ?? null;
    } catch (err) {
      setAwaitingTimelineRecalc(false);
      throw err;
    } finally {
      setOccurrenceResolving(false);
    }
  }

  async function toggleUnresolvedSelection(row: TransactionRowData, selected: boolean) {
    const key = projectionSelectionKey(row);
    if (!key) return;
    if (!selected) {
      clearPendingSelectionKeys([key]);
      return;
    }
    setPendingSelectionKeys((prev) => new Set(prev).add(key));
    setDeleteError(null);
    try {
      const transactionId = await resolveRowDataTransactionId(row);
      clearPendingSelectionKeys([key]);
      if (transactionId == null) {
        setDeleteError("Could not load this scheduled transaction for selection.");
        return;
      }
      toggleSelectedTransaction(transactionId, true);
    } catch (err) {
      clearPendingSelectionKeys([key]);
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not select scheduled transaction");
    }
  }

  async function selectAllLedgerRows(rows: TransactionRowData[], selected: boolean) {
    const unresolved = rows.filter((r) => r.transactionId == null);
    const unresolvedKeys = unresolved
      .map((r) => projectionSelectionKey(r))
      .filter((k): k is string => k != null);
    const knownIds = rows
      .map((r) => r.transactionId)
      .filter((id): id is number => id != null);

    if (!selected) {
      setSelectedTransactionGroup(knownIds, false);
      clearPendingSelectionKeys(unresolvedKeys);
      return;
    }

    setSelectedTransactionGroup(knownIds, true);
    if (unresolved.length === 0) return;

    setPendingSelectionKeys((prev) => {
      const next = new Set(prev);
      for (const key of unresolvedKeys) next.add(key);
      return next;
    });
    setDeleteError(null);
    setOccurrenceResolving(true);
    setAwaitingTimelineRecalc(true);
    try {
      const resolvedIds: number[] = [];
      await Promise.all(
        unresolved.map(async (row) => {
          if (row.source.rule_id == null || row.accountId == null) return;
          try {
            const resolved = await resolveRuleOccurrence({
              rule_id: row.source.rule_id,
              account_id: row.accountId,
              occurrence_date: row.date,
            });
            if (resolved.transaction_id != null) resolvedIds.push(resolved.transaction_id);
          } catch {
            /* skip rows that fail to materialize */
          }
        })
      );
      await queryClient.cancelQueries({ queryKey: ["timeline"] });
      await queryClient.refetchQueries({ queryKey: ["timeline"], type: "active" });
      clearPendingSelectionKeys(unresolvedKeys);
      if (resolvedIds.length > 0) setSelectedTransactionGroup(resolvedIds, true);
    } catch (err) {
      clearPendingSelectionKeys(unresolvedKeys);
      setAwaitingTimelineRecalc(false);
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : String(err);
      setDeleteError(msg || "Could not select scheduled transactions");
    } finally {
      setOccurrenceResolving(false);
    }
  }

  function confirmBatchDelete() {
    const ids = Array.from(selectedTransactionIds);
    if (ids.length === 0) return;
    setDeleteError(null);
    const noun = ids.length === 1 ? "transaction" : "transactions";
    if (
      window.confirm(
        `Delete ${ids.length} selected ${noun}? This cannot be undone. Reconciled rows will be skipped.`
      )
    ) {
      batchDeleteMu.mutate(ids);
    }
  }

  function confirmSkipOccurrence(id: number, label: string) {
    setDeleteError(null);
    if (
      window.confirm(
        `Skip this occurrence of "${label}"? It will not affect your balance and won't happen again on this date.`
      )
    ) {
      skipOccurrenceMu.mutate(id);
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
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden w-full px-4 sm:px-6 lg:px-8 pt-2 pb-2">
      {isPlaidOAuthReturn ? (
        <div className="sr-only" aria-hidden>
          <PlaidConnectBar householdId={plaidHouseholdId} />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 mb-3 flex-shrink-0">
        {account &&
          ledgerSections.today?.type === "today_balance" &&
          ledgerCurrentBalance != null &&
          forecastSummaryExpanded && (
            <ForecastSummaryBar
              account={account}
              currentBalance={ledgerCurrentBalance}
              isCredit={isCredit}
              currency={currency}
              nextRiskDate={ledgerFirstNegative?.date ?? null}
              firstNegativeAmount={ledgerFirstNegative?.balance ?? null}
              householdWarnings={householdWarnings}
              expanded
              onToggle={() => setForecastSummaryExpanded((v) => !v)}
              ledgerLowestProjected={ledgerLowestProjected?.balance ?? null}
              ledgerLowestProjectedDate={ledgerLowestProjected?.date ?? null}
              loading={!forecastSummaryReady}
            />
          )}

        <div className="flex flex-col gap-2 w-full sm:flex-row sm:flex-wrap sm:items-end">
          {showReconciled && (
          <div className="w-full sm:w-auto sm:min-w-[8rem]">
            <label className="block text-xs font-medium text-gray-500 mb-0.5">History Range</label>
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
              className="w-full sm:w-auto rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="14d">2 weeks</option>
              <option value="1m">30 days</option>
              <option value="3m">3 months</option>
              <option value="6m">6 months</option>
              <option value="12m">12 months</option>
              <option value="18m">18 months</option>
              <option value="24m">24 months</option>
              <option value="36m">36 months</option>
            </select>
          </div>
          )}
          <div className="w-full sm:w-auto sm:min-w-[8rem]">
            <label className="block text-xs font-medium text-gray-500 mb-0.5">Forecast Window</label>
            <select
              value={forecastRange}
              onChange={(e) => setForecastDays(forecastRangeToDays(e.target.value as ForecastRange))}
              className="w-full sm:w-auto rounded border border-gray-300 px-3 py-1.5 text-sm"
              disabled={!forecastReady}
            >
              <option value="30d">30 days</option>
              <option value="60d">60 days</option>
              <option value="90d">90 days</option>
              <option value="6m">6 months</option>
            </select>
          </div>
          <div className="w-full sm:w-auto sm:min-w-[12rem]">
            <label className="block text-xs font-medium text-gray-500 mb-0.5">Account</label>
            <select
              value={accountId === "" ? "" : String(accountId)}
              onChange={(e) => setAccountId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="">Select an account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountOptionLabel(a)}
                </option>
              ))}
            </select>
          </div>
          <ShowReconciledFilter
            showReconciled={showReconciled}
            onShowReconciledChange={setShowReconciled}
          />
          {hasUrlCategory && (
            <p className="text-xs text-gray-600 self-end pb-1.5">
              Posted history filtered to a category.{" "}
              <button
                type="button"
                className="text-blue-700 hover:underline"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("category");
                  setSearchParams(next, { replace: true });
                }}
              >
                Clear
              </button>
            </p>
          )}
          <TransactionColumnFilters
            amountMin={amountMinInput}
            amountMax={amountMaxInput}
            onAmountMinChange={setAmountMinInput}
            onAmountMaxChange={setAmountMaxInput}
            showClear={pastFiltersActive}
            onClear={() => {
              setAmountMinInput("");
              setAmountMaxInput("");
            }}
          />
          {accountId && isCreditAccount && (
            <div className="flex flex-wrap items-end gap-x-2 gap-y-1 self-end pb-0.5">
              <span className="text-xs font-medium text-slate-600 pb-1.5">Payoff:</span>
              <span className="text-slate-400 text-xs pb-1.5">$</span>
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
                className="w-16 rounded border border-slate-300 px-1.5 py-1.5 text-xs"
              />
              <span className="text-slate-500 text-xs pb-1.5">/mo</span>
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
                className="px-1.5 py-1.5 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {payoffLoading ? "…" : "Calc"}
              </button>
              {payoffError && <span className="text-xs text-red-600 pb-1.5">{payoffError}</span>}
              {payoffResult != null && payoffResult.months_to_payoff > 0 && (
                <span className="text-xs text-slate-700 pb-1.5">
                  → {payoffResult.months_to_payoff} pmts
                  {payoffResult.payoff_date && <> by {formatDateDisplay(payoffResult.payoff_date)}</>}
                </span>
              )}
              {payoffResult != null && payoffResult.months_to_payoff === 0 && (
                <span className="text-xs text-green-700 pb-1.5">Paid off</span>
              )}
            </div>
          )}
          {account &&
            ledgerSections.today?.type === "today_balance" &&
            ledgerCurrentBalance != null &&
            !forecastSummaryExpanded && (
              <ForecastSummaryBar
                account={account}
                currentBalance={ledgerCurrentBalance}
                isCredit={isCredit}
                currency={currency}
                nextRiskDate={ledgerFirstNegative?.date ?? null}
                firstNegativeAmount={ledgerFirstNegative?.balance ?? null}
                householdWarnings={householdWarnings}
                expanded={false}
                onToggle={() => setForecastSummaryExpanded((v) => !v)}
                ledgerLowestProjected={ledgerLowestProjected?.balance ?? null}
                ledgerLowestProjectedDate={ledgerLowestProjected?.date ?? null}
                loading={!forecastSummaryReady}
              />
            )}
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

      {(selectedTransactionIds.size > 0 || pendingSelectionKeys.size > 0) &&
        !editing && (
        <div className="mb-3 sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950 shadow-sm">
          <span className="font-medium">
            {selectedTransactionIds.size > 0
              ? `${selectedTransactionIds.size} selected`
              : "Selecting…"}
            {pendingSelectionKeys.size > 0
              ? `${selectedTransactionIds.size > 0 ? " · " : ""}resolving ${pendingSelectionKeys.size}…`
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedTransactionIds(new Set());
                setPendingSelectionKeys(new Set());
              }}
              disabled={batchDeleteMu.isPending}
              className="rounded border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={confirmBatchDelete}
              disabled={batchDeleteMu.isPending}
              className="rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {batchDeleteMu.isPending
                ? "Deleting…"
                : `Delete ${selectedTransactionIds.size} selected`}
            </button>
          </div>
        </div>
      )}

      {!accountId ? (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          Select an account to view the transaction ledger
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow overflow-hidden">
          {!accountMatchesSelection && accountFetching ? (
            <p className="shrink-0 text-sm text-gray-600 bg-gray-50 border-b border-gray-200 px-4 py-2" role="status">
              Loading account…
            </p>
          ) : null}
          {forecastRangeLoading ? (
            <p
              className="shrink-0 text-sm text-amber-900/80 bg-amber-50/80 border-b border-amber-100 px-4 py-1.5 flex items-center gap-2"
              role="status"
            >
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-600 border-t-transparent"
                aria-hidden
              />
              Loading {forecastRangeLabel(forecastRange)} forecast…
            </p>
          ) : null}
          {balancesRecalculating && accountMatchesSelection ? (
            <p
              className="shrink-0 text-sm text-amber-900/80 bg-amber-50/80 border-b border-amber-100 px-4 py-1.5 flex items-center gap-2"
              role="status"
            >
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-600 border-t-transparent"
                aria-hidden
              />
              Recalculating forecast…
            </p>
          ) : null}
          {ledgerTimelineError && !ledgerTimelineFetching && transactions.length > 0 ? (
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
            accountTimeline={accountTimeline}
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
            hasMoreHistory={Boolean(hasNextPage)}
            isLoadingMoreHistory={isFetchingNextPage}
            onLoadMoreHistory={() => {
              if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
            }}
            accountId={accountId}
            onEditRow={openEditByLedgerRow}
            onEditTransaction={openEdit}
            onDuplicateById={duplicateByTimelineId}
            onDuplicate={duplicateTransaction}
            onDeleteRow={confirmDeleteRow}
            onDelete={confirmDelete}
            deletePending={deleteMu.isPending || batchDeleteMu.isPending}
            selectedIds={selectedTransactionIds}
            onToggleSelected={toggleSelectedTransaction}
            onSetSelectedIds={setSelectedTransactionGroup}
          />

          {filteredPendingRows.length > 0 ? (
            <PendingExpectedSection
              pending={filteredPendingRows}
              accountTimeline={accountTimeline}
              currency={currency}
              isCredit={isCredit}
              hiddenByPast={pastExpanded || forecastExpanded}
              onEditRow={openEditByLedgerRow}
              onMatchesImportedRow={matchesImportedRow}
              onSkipRow={confirmSkipRow}
              onMoveDateRow={moveDateExpectedRow}
              onDeleteRow={confirmDeleteRow}
              actionsPending={forecastActionsLocked}
              selectedIds={selectedTransactionIds}
              pendingSelectionKeys={pendingSelectionKeys}
              onToggleSelected={toggleSelectedTransaction}
              onSelectUnresolved={toggleUnresolvedSelection}
              onSetSelectedIds={setSelectedTransactionGroup}
              onSelectAllRows={selectAllLedgerRows}
            />
          ) : null}

          <div className="flex-none shrink-0 z-10">
          <InlineAddRow
            form={inlineRow}
            onChange={(patch) => setInlineRow((r) => ({ ...r, ...patch }))}
            onSubmit={() => handleInlineAdd()}
            onCancel={resetInlineRow}
            categories={categoryDropdownOptions}
            transferToAccounts={transferToAccounts}
            isTransferCategory={isTransferCategory}
            transferCategoryName={selectedCategory?.name}
            isPending={createMu.isPending || createTransferMu.isPending}
            currency={currency}
            inlinePayToCardAccountId={inlinePayToCardAccountId}
            inlineCardTimelineLoading={inlineCardTimelineLoadingResolved}
            inlineOwedAsOfPaymentDate={inlineOwedAsOfPaymentDate}
            inlineBankTransferDestId={inlineBankTransferDestId}
            inlineBankDestTimelineLoading={inlineBankDestTimelineLoadingResolved}
            inlineDestPickAccount={inlineDestPickAccount}
            inlineBankDestBalanceBefore={inlineBankDestBalanceBefore}
            inlineBankDestBalanceAfter={inlineBankDestBalanceAfter}
            cardCurrency={accounts.find((a) => a.id === inlinePayToCardAccountId)?.currency}
          />
          </div>

          <ForecastCardsSection
            future={filteredFutureRows}
            accountTimeline={accountTimeline}
            currency={currency}
            isCredit={isCredit}
            isCreditAccount={isCreditAccount}
            expanded={forecastExpanded}
            hiddenByPast={pastExpanded}
            balancesRecalculating={balancesRecalculating}
            onToggleExpanded={() => {
              setForecastExpanded((v) => {
                const next = !v;
                if (next) setPastExpanded(false);
                return next;
              });
            }}
            onEditRow={openEditByLedgerRow}
            onEditTransaction={openEdit}
            onSkipRow={confirmSkipRow}
            onDeleteRow={confirmDeleteRow}
            onDeleteTransaction={confirmDelete}
            deletePending={forecastActionsLocked}
            minimumBuffer={
              account?.minimum_buffer != null && String(account.minimum_buffer).trim() !== ""
                ? parseFloat(String(account.minimum_buffer))
                : null
            }
            selectedIds={selectedTransactionIds}
            pendingSelectionKeys={pendingSelectionKeys}
            onToggleSelected={toggleSelectedTransaction}
            onSelectUnresolved={toggleUnresolvedSelection}
            onSetSelectedIds={setSelectedTransactionGroup}
            onSelectAllRows={selectAllLedgerRows}
          />
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">Edit transaction</h2>
            {editingLockMessage && (
              <p className="mb-4 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                {editingLockMessage}
              </p>
            )}
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
                    className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-600"
                    required
                    disabled={editingFinancialLocked}
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
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-600"
                  required
                  disabled={editingFinancialLocked}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Payee</label>
                <input
                  type="text"
                  value={editForm.payee}
                  onChange={(e) => setEditForm((f) => ({ ...f, payee: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-600"
                  disabled={editingPayeeLocked}
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
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-600"
                  disabled={editingPayeeLocked}
                >
                  <option value="">None</option>
                  {categoryDropdownOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                {editIsLinkedTransfer && editCategory?.name !== "Credit Card Payment" && (
                  <p className="mt-1 text-xs text-gray-500">
                    For card payments, choose category <strong>Credit Card Payment</strong> so reporting matches a payoff.
                  </p>
                )}
              </div>
              {showEditPaidFromSelector && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Paid from</label>
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
                    required
                  >
                    <option value="">Select paying account</option>
                    {editTransferToAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Creates the matching outflow on that account so both legs of this card payment stay together.
                  </p>
                </div>
              )}
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
                  {editTransferPreview.isFetching && !editTransferPreview.data ? (
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
                    From the card’s timeline on or before this date. This transfer is excluded so the amount
                    reflects what you still owe besides this payment.
                  </p>
                </div>
              )}
              {editBankTransferDestId != null && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-medium text-gray-700">
                    {editDestinationAccount?.name ?? "Destination"} — balance on{" "}
                    {formatDateDisplay(editForm.date)} (from your timeline)
                  </div>
                  {editTransferPreview.isFetching && !editTransferPreview.data ? (
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
                  disabled={editingFinancialLocked || (editIsTransferInflowLeg && editIsLinkedTransfer)}
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
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 disabled:bg-gray-100 disabled:text-gray-600"
                  required
                  disabled={editingFinancialLocked}
                />
              </div>
              {editingRuleId != null && !editingFinancialLocked && (
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
                  disabled={updateMu.isPending || editingReconciled}
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
