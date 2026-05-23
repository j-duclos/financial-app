import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import TodayCard from "../components/transactions/TodayCard";
import PastSection from "../components/transactions/PastSection";
import ForecastCardsSection from "../components/transactions/ForecastCardsSection";
import AddTransactionModal from "../components/transactions/AddTransactionModal";
import MaintenanceMenu from "../components/transactions/MaintenanceMenu";
import ViewModeToggle from "../components/transactions/ViewModeToggle";
import {
  todayStr,
  formatDateDisplay,
  addMonths,
  addDaysToIsoDate,
  maxIsoDate,
  creditOwedAsOfDateFromTimeline,
  assetBalanceAsOfDateFromTimeline,
  buildLedgerRows,
  buildLedgerRowsFromTimeline,
  splitLedgerSections,
  isTransferCategoryName,
  TIME_FILTER_MONTHS,
  type TimeFilter,
  type ViewMode,
} from "../components/transactions/transactionsLedgerUtils";

export type { TimeFilter };

type TransactionsLocationState = {
  accountId?: number;
  focus?: string;
  focusPlaid?: boolean;
};

export default function Transactions() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navState = (location.state as TransactionsLocationState | null) ?? null;
  const isPlaidOAuthReturn = searchParams.has("oauth_state_id") || navState?.focusPlaid === true;
  const [accountId, setAccountId] = useState<number | "">("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("3m");
  const hasSetInitialAccount = useRef(false);
  const pastScrollRef = useRef<HTMLDivElement>(null);

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  useEffect(() => {
    if (hasSetInitialAccount.current) return;
    if (navState?.accountId != null) {
      setAccountId(navState.accountId);
      hasSetInitialAccount.current = true;
      if (navState.focus === "view_upcoming") {
        setLedgerPanelFocus("future");
      }
      return;
    }
    const defaultId = profile?.default_account;
    if (defaultId != null) {
      setAccountId(Number(defaultId));
      hasSetInitialAccount.current = true;
    }
  }, [profile?.default_account, navState?.accountId]);

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
  /** split = default heights; past = maximize past (future collapsed); future = maximize future (past collapsed) */
  const [ledgerPanelFocus, setLedgerPanelFocus] = useState<"split" | "past" | "future">("split");
  const [forecastSummaryExpanded, setForecastSummaryExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [householdProjectionOpen, setHouseholdProjectionOpen] = useState(true);
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
  const queryClient = useQueryClient();

  const months = TIME_FILTER_MONTHS[timeFilter];
  const timelineStart = useMemo(() => addMonths(-months), [months]);
  const timelineEnd = useMemo(() => addMonths(months), [months]);

  const { data: txnsData } = useQuery({
    queryKey: ["transactions", { account: accountId || undefined, page_size: 5000 }],
    queryFn: () =>
      listTransactions({
        ...(accountId ? { account: accountId as number, page_size: 5000 } : {}),
      }),
    enabled: !!accountId,
    staleTime: 0,
    /** Avoid showing another account’s cached ledger after switching back (stale inactive queries). */
    refetchOnMount: "always",
  });
  const { data: timelineData } = useQuery({
    queryKey: ["timeline", timelineStart, timelineEnd, accountId, todayStr()],
    queryFn: () =>
      getTimeline({
        start: timelineStart,
        end: timelineEnd,
        as_of: todayStr(),
        account_id: typeof accountId === "number" ? accountId : undefined,
      }),
    enabled: typeof accountId === "number",
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: accountData } = useQuery({
    queryKey: ["account", accountId, "forecast", "health"],
    queryFn: () =>
      getAccount(accountId as number, true, { forecast_summary: true, health: true, days: 30 }),
    enabled: !!accountId,
    staleTime: 0,
  });
  const { data: accountsData } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    staleTime: 0,
  });
  const { data: categoriesData } = useQuery({
    queryKey: ["categories", "transactions", accountData?.household?.id ?? "all"],
    queryFn: () =>
      listCategories({
        page_size: 500,
        ...(accountData?.household?.id ? { household: accountData.household.id } : {}),
      }),
    enabled: !!accountId,
    refetchOnMount: "always",
  });

  const transactions = txnsData?.results ?? [];
  const account = accountData;
  const accounts = accountsData?.results ?? [];
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

  const inlineCardTimelineEnd = useMemo(
    () =>
      inlineRow.date ? addDaysToIsoDate(maxIsoDate(inlineRow.date, todayStr()), 450) : addDaysToIsoDate(todayStr(), 450),
    [inlineRow.date]
  );

  const { data: inlineCardTimelineData, isFetching: inlineCardTimelineLoading } = useQuery({
    queryKey: ["timeline", "card-projection", inlinePayToCardAccountId, inlineRow.date, inlineCardTimelineEnd, todayStr()],
    queryFn: () =>
      getTimeline({
        start: "2010-01-01",
        end: inlineCardTimelineEnd,
        as_of: todayStr(),
        account_id: inlinePayToCardAccountId!,
      }),
    enabled: inlinePayToCardAccountId != null && !!inlineRow.date,
    staleTime: 20_000,
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
      inlineRow.date,
      inlineCardTimelineEnd,
      todayStr(),
    ],
    queryFn: () =>
      getTimeline({
        start: "2010-01-01",
        end: inlineCardTimelineEnd,
        as_of: todayStr(),
        account_id: inlineBankTransferDestId!,
      }),
    enabled: inlineBankTransferDestId != null && !!inlineRow.date,
    staleTime: 20_000,
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
  /** “Payment to” / “Transfer to” only applies when money is leaving another account toward a destination — not when editing the card side of a payment. */
  const hideEditTransferToSelector =
    editIsCreditCardInflow &&
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

  const editCardTimelineEnd = useMemo(
    () =>
      editForm.date ? addDaysToIsoDate(maxIsoDate(editForm.date, todayStr()), 450) : addDaysToIsoDate(todayStr(), 450),
    [editForm.date]
  );

  const { data: editCardTimelineData, isFetching: editCardTimelineLoading } = useQuery({
    queryKey: [
      "timeline",
      "card-projection",
      editPayToCardId,
      editForm.date,
      editCardTimelineEnd,
      todayStr(),
      editing?.id,
    ],
    queryFn: () =>
      getTimeline({
        start: "2010-01-01",
        end: editCardTimelineEnd,
        as_of: todayStr(),
        account_id: editPayToCardId!,
      }),
    enabled: editPayToCardId != null && !!editForm.date,
    staleTime: 20_000,
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
      editForm.date,
      editCardTimelineEnd,
      todayStr(),
      editing?.id,
    ],
    queryFn: () =>
      getTimeline({
        start: "2010-01-01",
        end: editCardTimelineEnd,
        as_of: todayStr(),
        account_id: editBankTransferDestId!,
      }),
    enabled: editBankTransferDestId != null && !!editForm.date,
    staleTime: 20_000,
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
    enabled: !!householdId && !!timelineStart && !!timelineEnd,
    staleTime: 0,
    refetchOnMount: "always",
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

  /** Per-account projected high/low for the selected time range (household-wide; matches former single-account copy). */
  const householdProjectionLines = useMemo(() => {
    const timeline = householdTimelineData?.timeline ?? [];
    if (!timeline.length || !accountsForHousehold.length) return [] as { key: string; text: string }[];
    const lines: { key: string; text: string }[] = [];
    for (const acc of accountsForHousehold) {
      const cur = acc.currency ?? "USD";
      const accRows = timeline
        .filter((r) => Number(r.account_id) === Number(acc.id) && r.date > today)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (accRows.length === 0) continue;
      const isCredit = String(acc.account_type ?? "").toUpperCase() === "CREDIT";
      let minBal = Infinity;
      let maxBal = -Infinity;
      let minRow = accRows[0];
      let maxRow = accRows[0];
      for (const r of accRows) {
        const bal = parseFloat(r.running_balance);
        if (bal < minBal) {
          minBal = bal;
          minRow = r;
        }
        if (bal > maxBal) {
          maxBal = bal;
          maxRow = r;
        }
      }
      if (isCredit) {
        lines.push({
          key: `${acc.id}-credit-high`,
          text: `${acc.name}: Highest projected in this time range: ${formatCurrency(-minBal, cur)} on ${formatDateDisplay(minRow.date)}`,
        });
        lines.push({
          key: `${acc.id}-credit-low`,
          text: `${acc.name}: Lowest projected in this time range: ${formatCurrency(-maxBal, cur)} on ${formatDateDisplay(maxRow.date)}`,
        });
      } else {
        lines.push({
          key: `${acc.id}-bank-low`,
          text: `${acc.name}: Lowest projected in this time range: ${formatCurrency(minBal, cur)} on ${formatDateDisplay(minRow.date)}`,
        });
      }
    }
    return lines;
  }, [householdTimelineData?.timeline, accountsForHousehold, today]);

  const ledgerRows = useMemo(() => {
    if (!account || typeof accountId !== "number") return [];
    const today = todayStr();
    const accountBalance = account.balance != null ? parseFloat(account.balance) : (account.starting_balance ? parseFloat(account.starting_balance) : 0);
    if (timelineData?.timeline != null && timelineData.timeline.length >= 0) {
      // Only this account’s ledger lines (defense in depth if the API omits account_id or returns
      // a household-wide timeline). Coerce IDs — JSON or proxies may stringify numeric ids.
      const aid = Number(accountId);
      const timelineForAccount = timelineData.timeline.filter((r) => Number(r.account_id) === aid);
      return buildLedgerRowsFromTimeline(timelineForAccount, today, accountBalance, isCreditAccount);
    }
    const start = account.starting_balance ? parseFloat(account.starting_balance) : 0;
    return buildLedgerRows(transactions, start, account.currency, isCreditAccount);
  }, [account, accountId, transactions, timelineData?.timeline, isCreditAccount]);

  /** Split into: start, past, today, future (scheduled transactions under Today's Ending Balance). */
  const ledgerSections = useMemo(() => splitLedgerSections(ledgerRows), [ledgerRows]);

  // Same single scrollbar on past section — just start it at bottom (most recent); scroll up for older
  useEffect(() => {
    const el = pastScrollRef.current;
    if (!el) return;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    };
    scrollToBottom();
    const rafId = requestAnimationFrame(scrollToBottom);
    const t1 = setTimeout(scrollToBottom, 50);
    const t2 = setTimeout(scrollToBottom, 200);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [accountId, ledgerSections.past.length, ledgerPanelFocus]);

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

  const createMu = useMutation({
    mutationFn: createTransaction,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["account", accountId] }),
        queryClient.invalidateQueries({ queryKey: ["timeline"] }),
      ]);
      resetInlineRow();
      setAddModalOpen(false);
    },
  });

  const createTransferMu = useMutation({
    mutationFn: (body: Parameters<typeof createTransfer>[0]) => createTransfer(body),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["account", accountId] }),
        queryClient.invalidateQueries({ queryKey: ["account", variables.from_account] }),
        queryClient.invalidateQueries({ queryKey: ["account", variables.to_account] }),
        queryClient.invalidateQueries({ queryKey: ["timeline"] }),
      ]);
      resetInlineRow();
      setAddModalOpen(false);
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
    onError: (err: Error) => {
      const msg = err instanceof ApiError ? `${err.status}: ${err.message}` : err.message;
      setDeleteError(msg || "Failed to save transaction");
    },
    onSuccess: async (updatedTxn, variables) => {
      setDeleteError(null);
      const txnId = variables.id;
      const newAccountId = variables.data.account_id;
      const syncedToAccountId = (updatedTxn as { synced_to_account_id?: number }).synced_to_account_id;
      const t = todayStr();
      const timelineKey = ["timeline", timelineStart, timelineEnd, accountId, t];
      queryClient.setQueryData(timelineKey, (old: { timeline?: { transaction_id: number | null; amount?: string; date?: string; description?: string }[] } | undefined) => {
        if (!old?.timeline) return old;
        return {
          ...old,
          timeline: old.timeline.map((r) =>
            r.transaction_id === txnId
              ? {
                  ...r,
                  ...(updatedTxn.date != null && { date: updatedTxn.date }),
                  ...(updatedTxn.payee != null && { description: updatedTxn.payee }),
                  ...(updatedTxn.amount != null && { amount: String(updatedTxn.amount) }),
                }
              : r
          ),
        };
      });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["account", accountId] });
      const accountIdsToRefetch = new Set([accountId]);
      if (newAccountId != null) accountIdsToRefetch.add(newAccountId);
      if (syncedToAccountId != null && syncedToAccountId !== accountId) accountIdsToRefetch.add(syncedToAccountId);
      await Promise.all(
        [...accountIdsToRefetch].flatMap((aid) => [
          queryClient.refetchQueries({
            queryKey: ["transactions", { account: aid, page_size: 5000 }],
            exact: true,
          }),
          queryClient.refetchQueries({
            queryKey: ["timeline", timelineStart, timelineEnd, aid, t],
            exact: true,
          }),
          queryClient.invalidateQueries({ queryKey: ["account", aid] }),
        ])
      );
      if (householdId != null) {
        await queryClient.refetchQueries({
          queryKey: ["timeline", "household", timelineStart, timelineEnd, householdId, t],
          exact: true,
        });
      }
      if (newAccountId != null) setAccountId(newAccountId);
      setEditing(null);
      setEditingRuleId(null);
      setApplyToRule(false);
    },
  });

  const deleteMu = useMutation({
    mutationFn: deleteTransaction,
    onSuccess: async () => {
      setDeleteError(null);
      const t = todayStr();
      if (typeof accountId !== "number") return;
      await Promise.all([
        queryClient.refetchQueries({
          queryKey: ["timeline", timelineStart, timelineEnd, accountId, t],
          exact: true,
        }),
        queryClient.refetchQueries({
          queryKey: ["transactions", { account: accountId, page_size: 5000 }],
          exact: true,
        }),
        queryClient.invalidateQueries({ queryKey: ["account", accountId] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      ]);
      if (householdId != null) {
        await queryClient.refetchQueries({
          queryKey: ["timeline", "household", timelineStart, timelineEnd, householdId, t],
          exact: true,
        });
      }
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
          ? "No orphaned rule rows found (future dated, from-rule source, no rule link)."
          : `Removed ${data.deleted} orphaned row(s). Refresh if counts look off.`
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["timeline"] }),
        queryClient.invalidateQueries({ queryKey: ["accounts"] }),
      ]);
      if (householdId != null) {
        queryClient.invalidateQueries({ queryKey: ["timeline", "household"] });
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
      editSrcSubmit != null &&
      String(editSrcSubmit.account_type ?? "").toUpperCase() === "CREDIT" &&
      editForm.direction === "INFLOW" &&
      (linkedTransfer || transferCategory);
    const payload = {
      date: editForm.date,
      payee: editForm.payee || "—",
      amount: String(signedAmount),
      category_id: editForm.category_id || null,
      ...(editForm.account_id ? { account_id: editForm.account_id as number } : {}),
      ...(!omitTransferToOnSubmit &&
      editForm.transfer_to_account_id &&
      (linkedTransfer || transferCategory)
        ? { transfer_to_account_id: editForm.transfer_to_account_id as number }
        : {}),
    };
    if (applyToRule && editingRuleId != null) {
      const ruleDirection =
        editForm.transfer_to_account_id && !omitTransferToOnSubmit
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
          ...(editForm.transfer_to_account_id && !omitTransferToOnSubmit
            ? { transfer_to_account_id: editForm.transfer_to_account_id as number }
            : {}),
        });
        queryClient.invalidateQueries({ queryKey: ["rules"] });
        queryClient.invalidateQueries({ queryKey: ["timeline"] });
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Failed to update rule");
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
      });
    }
  }

  const currency = account?.currency ?? "USD";
  const isCredit = isCreditAccount;
  const availableCredit =
    isCredit &&
    account?.credit_limit != null &&
    String(account.credit_limit).trim() !== ""
      ? (() => {
          const limit = parseFloat(account.credit_limit);
          const balance =
            ledgerSections.today?.balance != null
              ? ledgerSections.today.balance
              : account.balance != null
                ? parseFloat(account.balance)
                : 0;
          const amountOwed = balance < 0 ? Math.abs(balance) : 0;
          if (Number.isNaN(limit)) return null;
          return Math.max(0, limit - amountOwed);
        })()
      : null;
  const availableCreditBreakdown =
    isCredit &&
    account?.credit_limit != null &&
    String(account.credit_limit).trim() !== "" &&
    ledgerSections.today?.balance != null
      ? {
          limit: parseFloat(account.credit_limit),
          amountOwed: Math.max(0, -ledgerSections.today.balance),
        }
      : null;

  const hasFutureProjectionRows = ledgerSections.future.length > 0;
  const expandPastSection = hasFutureProjectionRows && ledgerPanelFocus === "past";
  const pastCollapsed = hasFutureProjectionRows && ledgerPanelFocus === "future";
  const futureCollapsed = hasFutureProjectionRows && ledgerPanelFocus === "past";

  const householdWarnings = useMemo(
    () => [
      ...negativeBalanceWarnings.map((w) => ({ ...w, kind: "negative" as const })),
      ...creditLimitWarnings.map((w) => ({ ...w, kind: "credit_limit" as const })),
    ],
    [negativeBalanceWarnings, creditLimitWarnings]
  );

  useEffect(() => {
    if (!hasFutureProjectionRows && ledgerPanelFocus === "future") {
      setLedgerPanelFocus("split");
    }
  }, [hasFutureProjectionRows, ledgerPanelFocus]);

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

  async function handleMove(transactionId: number) {
    await openEditByTimelineId(transactionId);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-6 pt-2 pb-6">
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
              currentBalance={ledgerSections.today.balance}
              isCredit={isCredit}
              currency={currency}
              nextRiskDate={account.risk_date ?? null}
              householdWarnings={householdWarnings}
              expanded={forecastSummaryExpanded}
              onToggle={() => setForecastSummaryExpanded((v) => !v)}
            />
          )}

          {householdId != null && householdProjectionLines.length > 0 && (
            <div className="text-gray-800 text-xs border border-slate-200 rounded bg-slate-50 overflow-hidden">
              <button
                type="button"
                onClick={() => setHouseholdProjectionOpen((open) => !open)}
                className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left hover:bg-slate-100/80"
                aria-expanded={householdProjectionOpen}
              >
                <span className="font-medium text-slate-600">
                  All accounts — projected in this time range
                  {!householdProjectionOpen && (
                    <span className="font-normal text-slate-500">
                      {" "}
                      ({householdProjectionLines.length} lines)
                    </span>
                  )}
                </span>
                <svg
                  className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${householdProjectionOpen ? "rotate-180" : ""}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              {householdProjectionOpen && (
                <div className="px-2.5 pb-1.5 space-y-0.5 border-t border-slate-200">
                  {householdProjectionLines.map((line) => (
                    <div key={line.key}>{line.text}</div>
                  ))}
                </div>
              )}
            </div>
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
                    const res = await getAccountPayoff(accountId as number, val);
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
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
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
            <label className="block text-xs font-medium text-gray-500 mb-0.5">Time range</label>
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
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
          <PastSection
            start={ledgerSections.start}
            past={ledgerSections.past}
            viewMode={viewMode}
            currency={currency}
            isCredit={isCredit}
            scrollRef={pastScrollRef}
            collapsed={pastCollapsed}
            expanded={expandPastSection}
            hasFuture={hasFutureProjectionRows}
            panelFocus={ledgerPanelFocus}
            onExpandFuture={() => setLedgerPanelFocus("future")}
            onBalancedLayout={() => setLedgerPanelFocus("split")}
            onShowPast={() => setLedgerPanelFocus("split")}
            onEditTimeline={openEditByTimelineId}
            onEditTransaction={openEdit}
            onDuplicateById={duplicateByTimelineId}
            onDuplicate={duplicateTransaction}
            onDelete={confirmDelete}
            deletePending={deleteMu.isPending}
          />

          {account && ledgerSections.today?.type === "today_balance" && (
            <TodayCard
              account={account}
              currentBalance={ledgerSections.today.balance}
              isCredit={isCredit}
              currency={currency}
              availableCredit={availableCredit}
              availableCreditBreakdown={availableCreditBreakdown}
              onAddClick={() => setAddModalOpen(true)}
            />
          )}

          <ForecastCardsSection
            future={ledgerSections.future}
            viewMode={viewMode}
            currency={currency}
            isCredit={isCredit}
            isCreditAccount={isCreditAccount}
            collapsed={futureCollapsed}
            panelFocus={ledgerPanelFocus}
            onExpandPast={() => setLedgerPanelFocus("past")}
            onBalancedLayout={() => setLedgerPanelFocus("split")}
            onShowFuture={() => setLedgerPanelFocus("split")}
            onEditTimeline={openEditByTimelineId}
            onMove={handleMove}
            onSkip={confirmSkip}
            onDelete={confirmDelete}
            deletePending={deleteMu.isPending}
          />
        </div>
      )}

      <AddTransactionModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        form={inlineRow}
        onChange={(patch) => setInlineRow((r) => ({ ...r, ...patch }))}
        onSubmit={() => handleInlineAdd()}
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
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
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
                      <span>All future transactions (update the recurring rule)</span>
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
