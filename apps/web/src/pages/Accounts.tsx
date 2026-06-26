import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ACCOUNT_TYPE_LABELS,
  inferAccountRoleFromType,
  getEffectiveDisplayName,
} from "@budget-app/shared";
import type { Account, AccountRole, AccountType } from "@budget-app/shared";
import {
  listHouseholds,
  createAccount,
  createHousehold,
  updateAccount,
  updateProfile,
  getProfile,
  getAccount,
  reorderAccounts,
  clearAllAccountTransactionsPreview,
  clearAllAccountTransactions,
} from "@budget-app/api-client";
import { PlaidConnectBar } from "../components/PlaidConnectBar";
import { ACCOUNT_ROLE_OPTIONS, getAccountRoleMeta } from "../lib/accountRoles";
import {
  DEFAULT_PASSIVE_FORECAST_DAYS,
  type PassiveForecastDays,
} from "../lib/safeToSpendLabels";
import { nextBillingCycleEndDate } from "../lib/billingCycle";
import { formatDateDisplay } from "../components/transactions/transactionsLedgerUtils";
import {
  filterAccounts,
  groupAccounts,
  reorderAccountsInGroup,
  accountsForPageStats,
} from "../lib/accountOrganization";
import {
  computeAccountsPageStats,
  formatAccountsPageSummaryLine,
} from "../lib/accountPageSummary";
import { useAccountOrganizationPreferences } from "../hooks/useAccountOrganizationPreferences";
import AccountOrganizationToolbar from "../components/accounts/AccountOrganizationToolbar";
import AccountGroupSection from "../components/accounts/AccountGroupSection";
import AccountsForecastAlertsPanel from "../components/accounts/AccountsForecastAlertsPanel";
import AccountLifecycleModal, {
  type LifecycleAction,
} from "../components/accounts/AccountLifecycleModal";
import ActionToast from "../components/quickActions/ActionToast";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import QuickTransactionModal from "../components/quickActions/QuickTransactionModal";
import QuickRecurringModal from "../components/quickActions/QuickRecurringModal";
import AccountForecastPanel from "../components/quickActions/AccountForecastPanel";
import ResolveRiskModal from "../components/resolveRisk/ResolveRiskModal";
import { useAccountsQuickActions } from "../hooks/useAccountsQuickActions";
import { useAccountsPageList } from "../hooks/useAccountsPageList";

function formatBillingCycleEndPreview(closingDay: string): string {
  const day = Number(closingDay);
  if (!Number.isFinite(day) || day < 1 || day > 31) return "";
  return formatDateDisplay(nextBillingCycleEndDate(day));
}

export default function Accounts() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [forecastDays, setForecastDays] = useState<PassiveForecastDays>(
    DEFAULT_PASSIVE_FORECAST_DAYS
  );
  const [resolveRiskAccount, setResolveRiskAccount] = useState<Account | null>(null);
  const [newHouseholdName, setNewHouseholdName] = useState("");
  const roleManuallySetRef = useRef(false);
  const [form, setForm] = useState<{
    name: string;
    display_name: string;
    purpose: string;
    notes: string;
    account_type: AccountType;
    role: AccountRole;
    minimum_buffer: string;
    institution: string;
    currency: string;
    starting_balance: string;
    apr: string;
    interest_rate: string;
    interest_cycle_end_day: string;
    credit_limit: string;
    target_utilization_percent: string;
    billing_cycle_end_day: string;
    statement_closing_day: string;
    payment_due_day: string;
    current_balance: string;
    statement_balance: string;
    minimum_payment_amount: string;
    autopay_enabled: boolean;
    autopay_account: string;
    autopay_type: string;
    autopay_fixed_amount: string;
    promotional_apr: string;
    promotional_end_date: string;
    last_four: string;
    preserve_partner_transfer_legs: boolean;
    include_in_available_credit: boolean;
  }>({
    name: "",
    display_name: "",
    purpose: "",
    notes: "",
    account_type: "CHECKING",
    role: "spending",
    minimum_buffer: "",
    institution: "",
    last_four: "",
    currency: "USD",
    starting_balance: "",
    apr: "",
    interest_rate: "",
    interest_cycle_end_day: "",
    credit_limit: "",
    target_utilization_percent: "10",
    billing_cycle_end_day: "",
    statement_closing_day: "",
    payment_due_day: "",
    current_balance: "",
    statement_balance: "",
    minimum_payment_amount: "",
    autopay_enabled: false,
    autopay_account: "",
    autopay_type: "minimum_payment",
    autopay_fixed_amount: "",
    promotional_apr: "",
    promotional_end_date: "",
    preserve_partner_transfer_legs: false,
    include_in_available_credit: true,
  });
  const queryClient = useQueryClient();

  function accountRoleFromApi(acc: Account): AccountRole {
    return acc.role ?? inferAccountRoleFromType(acc.account_type);
  }

  function emptyFormState(accountType: AccountType = "CHECKING") {
    return {
      name: "",
      display_name: "",
      purpose: "",
      notes: "",
      account_type: accountType,
      role: inferAccountRoleFromType(accountType),
      minimum_buffer: "",
      institution: "",
      last_four: "",
      currency: "USD",
      starting_balance: "",
      apr: "",
      interest_rate: "",
      interest_cycle_end_day: "",
      credit_limit: "",
      target_utilization_percent: "10",
      billing_cycle_end_day: "",
      statement_closing_day: "",
      payment_due_day: "",
      current_balance: "",
      statement_balance: "",
      minimum_payment_amount: "",
      autopay_enabled: false,
      autopay_account: "",
      autopay_type: "minimum_payment",
      autopay_fixed_amount: "",
      promotional_apr: "",
      promotional_end_date: "",
      preserve_partner_transfer_legs: false,
      include_in_available_credit: true,
    };
  }

  function formFromAccount(acc: Account) {
    return {
      name: acc.name,
      display_name: acc.display_name ?? acc.nickname ?? "",
      purpose: acc.purpose ?? "",
      notes: acc.notes ?? "",
      account_type: acc.account_type,
      role: accountRoleFromApi(acc),
      minimum_buffer: acc.minimum_buffer != null && acc.minimum_buffer !== "" ? String(acc.minimum_buffer) : "",
      institution: acc.institution ?? "",
      currency: acc.currency,
      starting_balance: acc.starting_balance ?? "",
      apr: acc.apr ?? "",
      interest_rate: acc.interest_rate ?? "",
      interest_cycle_end_day: acc.interest_cycle_end_day != null ? String(acc.interest_cycle_end_day) : "",
      credit_limit: acc.credit_limit != null && acc.credit_limit !== "" ? String(acc.credit_limit) : "",
      target_utilization_percent:
        acc.target_utilization_percent != null && acc.target_utilization_percent !== ""
          ? String(acc.target_utilization_percent)
          : "10",
      billing_cycle_end_day: acc.billing_cycle_end_day != null ? String(acc.billing_cycle_end_day) : "",
      statement_closing_day:
        acc.statement_closing_day != null
          ? String(acc.statement_closing_day)
          : acc.billing_cycle_end_day != null
            ? String(acc.billing_cycle_end_day)
            : "",
      payment_due_day: acc.payment_due_day != null ? String(acc.payment_due_day) : "",
      current_balance: acc.current_balance != null ? String(acc.current_balance) : acc.balance_owed ?? "",
      statement_balance: acc.statement_balance != null ? String(acc.statement_balance) : "",
      minimum_payment_amount: acc.minimum_payment_amount != null ? String(acc.minimum_payment_amount) : "",
      autopay_enabled: Boolean(acc.autopay_enabled),
      autopay_account: acc.autopay_account != null ? String(acc.autopay_account) : "",
      autopay_type: acc.autopay_type || "minimum_payment",
      autopay_fixed_amount: acc.autopay_fixed_amount != null ? String(acc.autopay_fixed_amount) : "",
      promotional_apr: acc.promotional_apr ?? "",
      promotional_end_date: acc.promotional_end_date ?? "",
      last_four: acc.last_four ?? "",
      preserve_partner_transfer_legs: Boolean(acc.preserve_partner_transfer_legs),
      include_in_available_credit: acc.include_in_available_credit !== false,
    };
  }

  function handleAccountTypeChange(nextType: AccountType) {
    setForm((f) => {
      const next = { ...f, account_type: nextType };
      if (!roleManuallySetRef.current) {
        next.role = inferAccountRoleFromType(nextType);
      }
      return next;
    });
  }

  const {
    prefs: orgPrefs,
    setGroupBy,
    setSortBy,
    setLayoutMode,
    setShowGroupSummaries,
    setFilters,
    toggleGroupCollapsed,
    isGroupCollapsed,
    resetPreferences,
  } = useAccountOrganizationPreferences();

  useEffect(() => {
    if (searchParams.get("attention") === "1") {
      setFilters((f) => ({
        ...f,
        healthStatuses: ["watch", "risk", "critical"],
      }));
    }
    if (searchParams.get("debtOnly") === "1") {
      setFilters((f) => ({ ...f, debtOnly: true, spendingOnly: false }));
    }
    if (searchParams.get("savingsOnly") === "1") {
      setFilters((f) => ({
        ...f,
        debtOnly: false,
        roles: ["savings", "emergency_fund", "investment"],
      }));
    }
    if (searchParams.get("cashOnly") === "1") {
      setFilters((f) => ({
        ...f,
        debtOnly: false,
        spendingOnly: true,
        roles: [],
      }));
    }
  }, [searchParams, setFilters]);

  const {
    accounts,
    isLoading: accountsLoading,
    isEnriching: accountsEnriching,
    enrichFailed: accountsEnrichFailed,
    isError: accountsError,
    error: accountsLoadError,
    refetch: refetchAccounts,
  } = useAccountsPageList(forecastDays, orgPrefs.filters);
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: editingAccount } = useQuery({
    queryKey: ["account", editing?.id],
    queryFn: () =>
      getAccount(editing!.id, true, { relationships: true, health: true, forecast_summary: true }),
    enabled: !!editing?.id && modalOpen,
  });
  const householdId =
    profile?.default_household ??
    households?.[0]?.id ??
    accounts[0]?.household?.id;

  const allowManualOrder =
    orgPrefs.sortBy === "custom" || orgPrefs.groupBy === "custom";

  const createMu = useMutation({
    mutationFn: (body: {
      household: number;
      name: string;
      account_type: string;
      institution?: string;
      currency?: string;
      starting_balance?: string | null;
      apr?: string | null;
      interest_rate?: string | null;
      interest_cycle_end_day?: number | null;
      credit_limit?: string | null;
      billing_cycle_end_day?: number | null;
      promotional_apr?: string | null;
      promotional_end_date?: string | null;
      role?: AccountRole;
      minimum_buffer?: string | null;
      preserve_partner_transfer_legs?: boolean;
    }) => createAccount(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setModalOpen(false);
      roleManuallySetRef.current = false;
      setForm(emptyFormState());
      setSubmitError(null);
    },
    onError: (err: Error) => setSubmitError(err.message || "Failed to create account"),
  });
  const updateMu = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Account> }) => updateAccount(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["account", variables.id] });
      setModalOpen(false);
      setEditing(null);
      setSubmitError(null);
    },
    onError: (err: Error) => setSubmitError(err.message || "Failed to update account"),
  });
  const [lifecycleTarget, setLifecycleTarget] = useState<Account | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction | null>(null);

  const openLifecycle = (acc: Account, action: LifecycleAction) => {
    setLifecycleTarget(acc);
    setLifecycleAction(action);
  };
  const [clearLedgerTarget, setClearLedgerTarget] = useState<Account | null>(null);
  const [clearLedgerConfirmName, setClearLedgerConfirmName] = useState("");
  const [clearLedgerError, setClearLedgerError] = useState<string | null>(null);

  const { data: clearLedgerPreview } = useQuery({
    queryKey: ["clear-ledger-preview", clearLedgerTarget?.id],
    queryFn: () => clearAllAccountTransactionsPreview(clearLedgerTarget!.id),
    enabled: clearLedgerTarget != null,
  });

  const clearLedgerMu = useMutation({
    mutationFn: (accountId: number) => clearAllAccountTransactions(accountId, { confirm: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["timeline"] });
      await queryClient.invalidateQueries({ queryKey: ["plaid-items"] });
      setClearLedgerTarget(null);
      setClearLedgerConfirmName("");
      setClearLedgerError(null);
    },
    onError: (err: Error) => {
      setClearLedgerError(err.message || "Could not clear transactions.");
    },
  });

  const invalidateAfterLifecycle = async () => {
    await queryClient.invalidateQueries({ queryKey: ["accounts"] });
    await queryClient.invalidateQueries({ queryKey: ["profile"] });
    await queryClient.invalidateQueries({ queryKey: ["timeline"] });
    await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    await queryClient.invalidateQueries({ queryKey: ["rules"] });
  };
  const createHouseholdMu = useMutation({
    mutationFn: (data: { name: string }) => createHousehold(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["households"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setNewHouseholdName("");
      setSubmitError(null);
    },
    onError: (err: Error) => setSubmitError(err.message || "Failed to create household"),
  });
  const setPrimaryMu = useMutation({
    mutationFn: (accountId: number) => updateProfile({ default_account: accountId }),
    onSuccess: (_, accountId) => {
      queryClient.setQueryData(["profile"], (old: { default_account?: number | null } | undefined) =>
        old ? { ...old, default_account: accountId } : old
      );
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
  const accountsQueryKey = [
    "accounts",
    { balance: "true", forecast_summary: "true", health: "true", days: forecastDays },
  ] as const;
  const reorderMu = useMutation({
    mutationFn: (accountIds: number[]) => reorderAccounts(accountIds),
    onMutate: async (accountIds) => {
      const prev = queryClient.getQueryData<{ results: Account[] }>(accountsQueryKey);
      if (!prev?.results) return {};
      const orderMap = new Map(accountIds.map((id, i) => [id, i]));
      const reordered = [...prev.results].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      await queryClient.cancelQueries({ queryKey: accountsQueryKey });
      queryClient.setQueryData(accountsQueryKey, { ...prev, results: reordered });
      return { previous: prev };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
    onError: (_err, _accountIds, context) => {
      if (context?.previous) queryClient.setQueryData(accountsQueryKey, context.previous);
    },
  });

  function openCreate() {
    setEditing(null);
    roleManuallySetRef.current = false;
    setForm(emptyFormState());
    setSubmitError(null);
    setNewHouseholdName("");
    setModalOpen(true);
  }
  function openEdit(acc: Account) {
    setEditing(acc);
    roleManuallySetRef.current = true;
    setSubmitError(null);
    setModalOpen(true);
    queryClient.invalidateQueries({ queryKey: ["account", acc.id] });
    setForm(formFromAccount(acc));
  }

  useEffect(() => {
    if (!editing?.id || !modalOpen || !editingAccount || editingAccount.id !== editing.id) return;
    setForm(formFromAccount(editingAccount));
  }, [editing?.id, modalOpen, editingAccount]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const parseDay = (s: string) => {
      if (!s.trim()) return null;
      const n = parseInt(s, 10);
      return n >= 1 && n <= 31 ? n : null;
    };
    const billingDay =
      form.account_type === "CREDIT" ? parseDay(form.statement_closing_day || form.billing_cycle_end_day) : null;
    const paymentDueDay = form.account_type === "CREDIT" ? parseDay(form.payment_due_day) : null;
    const interestCycleDay =
      form.account_type === "SAVINGS" && form.interest_cycle_end_day.trim()
        ? (() => {
            const n = parseInt(form.interest_cycle_end_day, 10);
            return n >= 1 && n <= 31 ? n : null;
          })()
        : null;
    const creditLimitStr = String(form.credit_limit ?? "").trim();
    const creditLimitValue = form.account_type === "CREDIT" && creditLimitStr ? creditLimitStr : null;
    const targetUtilStr = String(form.target_utilization_percent ?? "").trim();
    const targetUtilValue =
      form.account_type === "CREDIT" && targetUtilStr ? targetUtilStr : null;
    const interestRateStr = String(form.interest_rate ?? "").trim();
    const interestRateValue = form.account_type === "SAVINGS" && interestRateStr ? interestRateStr : null;
    // Always send interest_rate and interest_cycle_end_day (null when not SAVINGS) so backend persists them
    const interestRate = interestRateValue ?? null;
    const interestCycleDayVal = interestCycleDay ?? null;

    const displayNameVal = form.display_name.trim();
    const purposeVal = form.purpose.trim();
    const notesVal = form.notes;
    const lfDigits = form.last_four.replace(/\D/g, "").slice(-4);
    const lastFourPayload = lfDigits.length === 4 ? lfDigits : "";
    const bufferStr = form.minimum_buffer.trim();
    const minimumBuffer = bufferStr ? bufferStr : "0";
    if (editing) {
      const payload: Partial<Account> = {
        name: form.name,
        display_name: displayNameVal,
        purpose: purposeVal,
        notes: notesVal,
        account_type: form.account_type,
        role: form.role,
        minimum_buffer: minimumBuffer,
        institution: form.institution || "",
        last_four: lastFourPayload,
        currency: form.currency,
        starting_balance: form.starting_balance.trim() ? form.starting_balance : null,
        apr: form.account_type === "CREDIT" && form.apr.trim() ? form.apr : null,
        interest_rate: interestRate,
        interest_cycle_end_day: interestCycleDayVal,
        credit_limit: creditLimitValue,
        ...(form.account_type === "CREDIT" ? { target_utilization_percent: targetUtilValue ?? "10" } : {}),
        billing_cycle_end_day: billingDay,
        statement_closing_day: billingDay,
        payment_due_day: paymentDueDay,
        current_balance: form.account_type === "CREDIT" && form.current_balance.trim() ? form.current_balance : undefined,
        statement_balance: form.account_type === "CREDIT" && form.statement_balance.trim() ? form.statement_balance : undefined,
        minimum_payment_amount:
          form.account_type === "CREDIT" && form.minimum_payment_amount.trim() ? form.minimum_payment_amount : undefined,
        autopay_enabled: form.account_type === "CREDIT" ? form.autopay_enabled : undefined,
        autopay_account:
          form.account_type === "CREDIT" && form.autopay_account.trim() ? Number(form.autopay_account) : null,
        autopay_type: form.account_type === "CREDIT" ? form.autopay_type : undefined,
        autopay_fixed_amount:
          form.account_type === "CREDIT" && form.autopay_fixed_amount.trim() ? form.autopay_fixed_amount : undefined,
        promotional_apr: form.account_type === "CREDIT" && form.promotional_apr.trim() ? form.promotional_apr : null,
        promotional_end_date: form.account_type === "CREDIT" && form.promotional_end_date.trim() ? form.promotional_end_date : null,
        preserve_partner_transfer_legs: form.preserve_partner_transfer_legs,
        include_in_available_credit:
          form.account_type === "CREDIT" ? form.include_in_available_credit : undefined,
      };
      updateMu.mutate({ id: editing.id, data: payload });
    } else if (householdId != null) {
      const payload = {
        name: form.name,
        display_name: displayNameVal,
        purpose: purposeVal,
        notes: notesVal,
        account_type: form.account_type,
        role: form.role,
        minimum_buffer: minimumBuffer,
        institution: form.institution || "",
        last_four: lastFourPayload,
        currency: form.currency,
        starting_balance: form.starting_balance.trim() ? form.starting_balance : null,
        apr: form.account_type === "CREDIT" && form.apr.trim() ? form.apr : null,
        interest_rate: interestRate,
        interest_cycle_end_day: interestCycleDayVal,
        credit_limit: creditLimitValue ?? null,
        target_utilization_percent: targetUtilValue ?? "10",
        billing_cycle_end_day: billingDay ?? null,
        statement_closing_day: billingDay ?? null,
        payment_due_day: paymentDueDay ?? null,
        current_balance: form.account_type === "CREDIT" && form.current_balance.trim() ? form.current_balance : null,
        statement_balance: form.account_type === "CREDIT" && form.statement_balance.trim() ? form.statement_balance : null,
        minimum_payment_amount:
          form.account_type === "CREDIT" && form.minimum_payment_amount.trim() ? form.minimum_payment_amount : null,
        autopay_enabled: form.account_type === "CREDIT" ? form.autopay_enabled : false,
        autopay_account:
          form.account_type === "CREDIT" && form.autopay_account.trim() ? Number(form.autopay_account) : null,
        autopay_type: form.account_type === "CREDIT" ? form.autopay_type : "",
        autopay_fixed_amount:
          form.account_type === "CREDIT" && form.autopay_fixed_amount.trim() ? form.autopay_fixed_amount : null,
        promotional_apr: form.account_type === "CREDIT" && form.promotional_apr.trim() ? form.promotional_apr : null,
        promotional_end_date: form.account_type === "CREDIT" && form.promotional_end_date.trim() ? form.promotional_end_date : null,
        preserve_partner_transfer_legs: form.preserve_partner_transfer_legs,
        include_in_available_credit: form.account_type === "CREDIT" ? form.include_in_available_credit : true,
        household: householdId,
      };
      createMu.mutate(payload);
    } else {
      setSubmitError(
        "You need a household before adding accounts. Create one below, or wait for households to load."
      );
    }
  }

  function handleCreateHousehold(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!newHouseholdName.trim()) {
      setSubmitError("Please enter a household name.");
      return;
    }
    createHouseholdMu.mutate({ name: newHouseholdName.trim() });
  }

  const {
    quickActionsContext,
    plaidStats,
    toast,
    setToast,
    txnPreset,
    setTxnPreset,
    recurringPreset,
    setRecurringPreset,
    forecastAccount,
    setForecastAccount,
    handleQuickAction,
    accountRoleForQuickActions: roleForQuick,
  } = useAccountsQuickActions(accounts, householdId, forecastDays, openEdit);

  const filteredAccounts = useMemo(
    () =>
      filterAccounts(accounts, orgPrefs.filters, {
        plaidLinkedAccountIds: quickActionsContext.plaidLinkedAccountIds,
      }),
    [accounts, orgPrefs.filters, quickActionsContext.plaidLinkedAccountIds]
  );

  const accountGroups = useMemo(
    () => groupAccounts(filteredAccounts, orgPrefs.groupBy, orgPrefs.sortBy),
    [filteredAccounts, orgPrefs.groupBy, orgPrefs.sortBy]
  );

  const pageStats = useMemo(() => {
    const countable = accountsForPageStats(accounts, orgPrefs.filters);
    return computeAccountsPageStats(
      countable,
      plaidStats.bankLoginCount,
      plaidStats.linkedAccountCount
    );
  }, [accounts, orgPrefs.filters, plaidStats.bankLoginCount, plaidStats.linkedAccountCount]);

  const summaryLine = formatAccountsPageSummaryLine(pageStats);

  const [highlightedAccountId, setHighlightedAccountId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusAccount = useCallback((accountId: number) => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedAccountId(accountId);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-testid="account-row-${accountId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    highlightTimeoutRef.current = setTimeout(() => setHighlightedAccountId(null), 4500);
  }, []);

  useEffect(() => {
    const raw = searchParams.get("account");
    if (!raw || accounts.length === 0) return;
    const id = parseInt(raw, 10);
    if (!Number.isFinite(id) || !accounts.some((a) => a.id === id)) return;
    focusAccount(id);
  }, [searchParams, accounts, focusAccount]);

  useEffect(
    () => () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    },
    []
  );

  const handleMoveInGroup = useCallback(
    (groupKey: string, indexInGroup: number, direction: "up" | "down") => {
      const group = accountGroups.find((g) => g.key === groupKey);
      if (!group) return;
      const toIndex = direction === "up" ? indexInGroup - 1 : indexInGroup + 1;
      if (toIndex < 0 || toIndex >= group.accounts.length) return;
      const groupIds = group.accounts.map((a) => a.id);
      const newOrder = reorderAccountsInGroup(accounts, groupIds, indexInGroup, toIndex);
      reorderMu.mutate(newOrder);
    },
    [accountGroups, accounts, reorderMu]
  );

  return (
    <div className={PAGE_SHELL_PY} data-testid="accounts-page">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 w-full">
          <PlaidConnectBar householdId={householdId ?? null} />
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 self-start rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add account
        </button>
      </div>
      <AccountOrganizationToolbar
        forecastDays={forecastDays}
        onForecastDaysChange={setForecastDays}
        groupBy={orgPrefs.groupBy}
        sortBy={orgPrefs.sortBy}
        layoutMode={orgPrefs.layoutMode}
        showGroupSummaries={orgPrefs.showGroupSummaries}
        filters={orgPrefs.filters}
        accounts={accounts}
        summaryLine={
          accounts.length > 0
            ? summaryLine
            : "Organize accounts, health, and actions per account."
        }
        onGroupByChange={setGroupBy}
        onSortByChange={setSortBy}
        onLayoutModeChange={setLayoutMode}
        onShowGroupSummariesChange={setShowGroupSummaries}
        onFiltersChange={setFilters}
        onReset={resetPreferences}
      />

      <AccountsForecastAlertsPanel
        accounts={accounts}
        forecastDays={forecastDays}
        onViewAccount={focusAccount}
      />

      {accountsLoading ? (
        <div
          className="bg-white rounded-lg shadow border border-gray-200 p-8 text-center text-gray-600"
          data-testid="accounts-loading-state"
        >
          <p>Loading accounts…</p>
        </div>
      ) : accountsError && accounts.length === 0 ? (
        <div
          className="bg-white rounded-lg shadow border border-red-200 p-8 text-center text-red-700"
          data-testid="accounts-error-state"
        >
          <p className="mb-3">
            Could not load accounts
            {accountsLoadError instanceof Error && accountsLoadError.message
              ? `: ${accountsLoadError.message}`
              : "."}
          </p>
          <button
            type="button"
            onClick={() => refetchAccounts()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      ) : accountsEnriching || accountsEnrichFailed ? (
        <p
          className="mb-3 text-sm text-gray-500"
          data-testid="accounts-enrich-status"
          role="status"
        >
          {accountsEnriching
            ? "Loading forecasts and health scores…"
            : "Forecasts could not load; balances are shown. "}
          {accountsEnrichFailed && !accountsEnriching ? (
            <button
              type="button"
              onClick={() => refetchAccounts()}
              className="text-blue-600 hover:underline font-medium"
            >
              Retry forecasts
            </button>
          ) : null}
        </p>
      ) : null}

      {!accountsLoading && !accountsError && filteredAccounts.length === 0 ? (
        <div
          className="bg-white rounded-lg shadow border border-gray-200 p-8 text-center text-gray-600"
          data-testid="accounts-empty-state"
        >
          {accounts.length === 0 ? (
            <p>No accounts yet. Add your first account or link a bank.</p>
          ) : (
            <p>
              No accounts match these filters.{" "}
              <button
                type="button"
                onClick={resetPreferences}
                className="text-blue-600 hover:underline font-medium"
              >
                Reset filters
              </button>
              .
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
          {accountGroups.map((group) => (
            <AccountGroupSection
              key={group.key}
              group={group}
              groupBy={orgPrefs.groupBy}
              collapsed={isGroupCollapsed(group.key)}
              showSummary={orgPrefs.showGroupSummaries}
              layoutMode={orgPrefs.layoutMode}
              forecastDays={forecastDays}
              defaultAccountId={profile?.default_account}
              allowManualOrder={allowManualOrder}
              reorderPending={reorderMu.isPending}
              onToggleCollapse={() => toggleGroupCollapsed(group.key)}
              onMoveAccount={(index, direction) => handleMoveInGroup(group.key, index, direction)}
              onSetPrimary={(id) => setPrimaryMu.mutate(id)}
              onEdit={openEdit}
              onClearLedger={(acc) => {
                setClearLedgerError(null);
                setClearLedgerConfirmName("");
                setClearLedgerTarget(acc);
              }}
              onDelete={(acc) => openLifecycle(acc, "delete")}
              onArchive={(acc) => openLifecycle(acc, "archive")}
              onClose={(acc) => openLifecycle(acc, "close")}
              onRestore={(acc) => openLifecycle(acc, "restore")}
              onToggleForecast={(id, included) =>
                updateMu.mutate({ id, data: { include_in_forecast: included } })
              }
              onToggleActive={(id, active) => updateMu.mutate({ id, data: { archived: !active } })}
              accountRoleFromApi={accountRoleFromApi}
              setPrimaryPending={setPrimaryMu.isPending}
              updatePending={updateMu.isPending}
              quickActionsContext={quickActionsContext}
              onQuickAction={handleQuickAction}
              highlightedAccountId={highlightedAccountId}
              onFocusAccount={focusAccount}
              onResolveRisk={setResolveRiskAccount}
            />
          ))}
        </div>
      )}

      {clearLedgerTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-20">
          <div
            className="bg-white rounded-lg p-6 max-w-md w-full shadow-lg border border-gray-200"
            role="dialog"
            aria-labelledby="clear-ledger-title"
            aria-modal="true"
          >
            <h2 id="clear-ledger-title" className="text-lg font-semibold text-gray-900 mb-2">
              Clear all transactions?
            </h2>
            <p className="text-sm text-gray-700 mb-2">
              This removes <strong className="font-semibold">every</strong> ledger row on{" "}
              <strong className="font-semibold">{getEffectiveDisplayName(clearLedgerTarget)}</strong> — manual entries, Plaid imports,
              transfers (normally the other account&apos;s linked leg is removed too; accounts marked{" "}
              <em>preserve partner transfer legs</em> keep their side and only the link is removed), and reconcile
              statement lines for this account. Your <strong className="font-semibold">starting balance</strong> and
              account settings stay; automation schedules are not deleted.
            </p>
            <p className="text-sm text-gray-600 mb-3">
              {clearLedgerPreview != null ? (
                <>
                  About <strong className="font-semibold">{clearLedgerPreview.transaction_count}</strong> transaction
                  {clearLedgerPreview.transaction_count === 1 ? "" : "s"}
                  {clearLedgerPreview.statement_lines > 0 ? (
                    <>
                      {" "}
                      and <strong className="font-semibold">{clearLedgerPreview.statement_lines}</strong> reconcile
                      import line{clearLedgerPreview.statement_lines === 1 ? "" : "s"}
                    </>
                  ) : null}{" "}
                  will be removed. Then use <strong className="font-semibold">Import transactions</strong> on the
                  Transactions page to pull fresh data from Plaid.
                </>
              ) : (
                "Loading counts…"
              )}
            </p>
            <p className="text-sm text-gray-600 mb-2">
              Type the account name{" "}
              <span className="font-mono bg-gray-100 px-1 rounded">{getEffectiveDisplayName(clearLedgerTarget)}</span> to confirm:
            </p>
            <input
              type="text"
              value={clearLedgerConfirmName}
              onChange={(e) => {
                setClearLedgerConfirmName(e.target.value);
                setClearLedgerError(null);
              }}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm mb-3"
              placeholder="Account name"
              autoComplete="off"
              aria-label="Type account name to confirm clearing transactions"
            />
            {clearLedgerError && <p className="text-sm text-red-600 mb-3">{clearLedgerError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="py-2 px-4 border border-gray-300 rounded text-sm hover:bg-gray-50"
                onClick={() => {
                  setClearLedgerTarget(null);
                  setClearLedgerConfirmName("");
                  setClearLedgerError(null);
                }}
                disabled={clearLedgerMu.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="py-2 px-4 bg-amber-700 text-white rounded text-sm hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={
                  clearLedgerMu.isPending ||
                  clearLedgerConfirmName.trim() !== getEffectiveDisplayName(clearLedgerTarget).trim() ||
                  clearLedgerPreview == null
                }
                onClick={() => clearLedgerMu.mutate(clearLedgerTarget.id)}
              >
                {clearLedgerMu.isPending ? "Clearing…" : "Clear all transactions"}
              </button>
            </div>
          </div>
        </div>
      )}


      <AccountLifecycleModal
        account={lifecycleTarget}
        action={lifecycleAction}
        onClose={() => {
          setLifecycleTarget(null);
          setLifecycleAction(null);
        }}
        onSuccess={() => {
          void invalidateAfterLifecycle();
          if (
            lifecycleTarget &&
            editing?.id === lifecycleTarget.id &&
            lifecycleAction === "delete"
          ) {
            setModalOpen(false);
            setEditing(null);
          }
        }}
      />

      {resolveRiskAccount && (
        <ResolveRiskModal
          open
          accountId={resolveRiskAccount.id}
          accountName={getEffectiveDisplayName(resolveRiskAccount)}
          forecastDays={forecastDays}
          accounts={accounts}
          onClose={() => setResolveRiskAccount(null)}
          onApplyTransfer={(preset) => {
            setTxnPreset(preset);
            setResolveRiskAccount(null);
          }}
          onSnoozed={() => {
            void queryClient.invalidateQueries({ queryKey: ["accounts"] });
          }}
        />
      )}

      <ActionToast message={toast} onDismiss={() => setToast(null)} />
      <QuickTransactionModal
        open={txnPreset != null}
        preset={txnPreset}
        accounts={accounts}
        onClose={() => setTxnPreset(null)}
        onSuccess={setToast}
      />
      <QuickRecurringModal
        open={recurringPreset != null}
        preset={recurringPreset}
        accounts={accounts}
        onClose={() => setRecurringPreset(null)}
        onSuccess={setToast}
      />
      <AccountForecastPanel
        open={forecastAccount != null}
        account={forecastAccount}
        role={forecastAccount ? roleForQuick(forecastAccount) : "other"}
        forecastDays={forecastDays}
        onClose={() => setForecastAccount(null)}
        onViewLedger={() => {
          if (forecastAccount) {
            navigate("/transactions", { state: { accountId: forecastAccount.id } });
          }
          setForecastAccount(null);
        }}
        onViewUpcoming={() => {
          if (forecastAccount) {
            navigate("/transactions", {
              state: { accountId: forecastAccount.id, focus: "view_upcoming" },
            });
          }
          setForecastAccount(null);
        }}
        onSchedule={() => {
          if (!forecastAccount) return;
          const hid =
            typeof forecastAccount.household === "object"
              ? forecastAccount.household?.id
              : (forecastAccount.household as number | undefined);
          if (hid == null) return;
          const isCredit = forecastAccount.account_type === "CREDIT";
          const isSavings =
            forecastAccount.role === "savings" ||
            forecastAccount.role === "emergency_fund" ||
            forecastAccount.account_type === "SAVINGS";
          setRecurringPreset({
            accountId: forecastAccount.id,
            householdId: hid,
            direction: isCredit || isSavings ? "TRANSFER" : "EXPENSE",
          });
          setForecastAccount(null);
        }}
      />

      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-10">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4">{editing ? "Edit account" : "New account"}</h2>

            {!editing && householdId == null && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded">
                <p className="text-sm text-amber-800 mb-3">
                  Create a household first. Accounts must belong to a household.
                </p>
                <form onSubmit={handleCreateHousehold} className="flex gap-2">
                  <input
                    value={newHouseholdName}
                    onChange={(e) => setNewHouseholdName(e.target.value)}
                    placeholder="Household name"
                    className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={createHouseholdMu.isPending || !newHouseholdName.trim()}
                    className="py-2 px-3 bg-amber-600 text-white rounded text-sm hover:bg-amber-700 disabled:opacity-50"
                  >
                    {createHouseholdMu.isPending ? "Creating…" : "Create household"}
                  </button>
                </form>
              </div>
            )}

            {submitError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                {submitError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Official account name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                  required
                />
                <p className="mt-1 text-xs text-gray-500">
                  Bank or institution label (from Plaid or manual entry). Use display name for how you refer to it in the app.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Display name</label>
                <input
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder="e.g. Main Checking, Travel Card"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                />
                <p className="mt-1 text-xs text-gray-500">Short name shown throughout the app.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Purpose</label>
                <input
                  value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  placeholder="e.g. Primary spending account"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                />
                <p className="mt-1 text-xs text-gray-500">What is this account mainly used for?</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional reminders about this account"
                  rows={4}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">Optional notes about this account.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Type</label>
                <select
                  value={form.account_type}
                  onChange={(e) => handleAccountTypeChange(e.target.value as AccountType)}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                >
                  {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => {
                    roleManuallySetRef.current = true;
                    setForm((f) => ({ ...f, role: e.target.value as AccountRole }));
                  }}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                >
                  {ACCOUNT_ROLE_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {(() => {
                  const roleHelp = getAccountRoleMeta(form.role).description;
                  return roleHelp ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{roleHelp}</p>
                  ) : null;
                })()}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Minimum buffer</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minimum_buffer}
                  onChange={(e) => setForm((f) => ({ ...f, minimum_buffer: e.target.value }))}
                  placeholder="0.00"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Amount to keep untouched in this account for safety.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Institution</label>
                <input
                  value={form.institution}
                  onChange={(e) => setForm((f) => ({ ...f, institution: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Last four digits (optional)</label>
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={8}
                  placeholder="e.g. 1234"
                  value={form.last_four}
                  onChange={(e) => setForm((f) => ({ ...f, last_four: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2 font-mono tracking-widest max-w-[10rem]"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Used with bank linking (Plaid): must match the card or account ending — not your display name.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="preserve-partner-legs"
                  type="checkbox"
                  className="mt-1 rounded border-gray-300"
                  checked={form.preserve_partner_transfer_legs}
                  onChange={(e) => setForm((f) => ({ ...f, preserve_partner_transfer_legs: e.target.checked }))}
                />
                <label htmlFor="preserve-partner-legs" className="text-sm text-gray-700 cursor-pointer">
                  <span className="font-medium">Manual / non-Plaid ledger</span> — when the{" "}
                  <em>other</em> account clears or deletes its side of a transfer, keep this account&apos;s row and
                  remove only the link (e.g. Synchrony when Plaid cannot connect).
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Currency</label>
                <input
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Starting balance (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.starting_balance}
                  onChange={(e) => setForm((f) => ({ ...f, starting_balance: e.target.value }))}
                  placeholder="0.00"
                  className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                />
              </div>
              {form.account_type === "SAVINGS" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Interest rate / APY % (optional)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={form.interest_rate}
                      onChange={(e) => setForm((f) => ({ ...f, interest_rate: e.target.value }))}
                      placeholder="e.g. 4.50"
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Annual percentage yield; used to track interest paid on savings.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Interest cycle end day (optional)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={form.interest_cycle_end_day}
                      onChange={(e) => setForm((f) => ({ ...f, interest_cycle_end_day: e.target.value }))}
                      placeholder="e.g. 1 (interest credited on the 1st)"
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Day of month (1–31) when interest is credited. Used to project next interest income on the timeline.
                    </p>
                  </div>
                </>
              )}
              {form.account_type === "CREDIT" && (
                <>
                  <p className="text-sm font-semibold text-gray-800 border-b pb-1 col-span-full">Credit card details</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Credit limit (optional)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.credit_limit}
                      onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))}
                      placeholder="e.g. 5000.00"
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Used to show available credit on the Transactions page.
                    </p>
                  </div>
                  <div className="flex items-start gap-2 col-span-full">
                    <input
                      id="include-in-available-credit"
                      type="checkbox"
                      className="mt-1 rounded border-gray-300"
                      checked={form.include_in_available_credit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, include_in_available_credit: e.target.checked }))
                      }
                    />
                    <label htmlFor="include-in-available-credit" className="text-sm text-gray-700 cursor-pointer">
                      <span className="font-medium">Include in Available Credit total</span>
                      <span className="block text-xs text-gray-500 mt-0.5">
                        Uncheck for specialty cards you don&apos;t spend from day to day (e.g. medical or
                        store-only). They&apos;ll still appear on your accounts list and in debt totals.
                      </span>
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Target utilization %</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={form.target_utilization_percent}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, target_utilization_percent: e.target.value }))
                      }
                      placeholder="10"
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Healthy when balance is at or below this % of your limit (10% is a common credit-score target).
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">APR % (optional)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={form.apr}
                      onChange={(e) => setForm((f) => ({ ...f, apr: e.target.value }))}
                      placeholder="e.g. 18.99"
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Promotional APR % (optional)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={form.promotional_apr}
                      onChange={(e) => setForm((f) => ({ ...f, promotional_apr: e.target.value }))}
                      placeholder="e.g. 0 for interest-free"
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Intro/promo rate (e.g. 0%) until the end date below. After that, standard APR applies.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Promotional end date (optional)</label>
                    <input
                      type="date"
                      value={form.promotional_end_date}
                      onChange={(e) => setForm((f) => ({ ...f, promotional_end_date: e.target.value }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Last day the promotional APR applies (e.g. end of 0% for 12 months).
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Billing cycle end day (1–31)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={form.statement_closing_day}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          statement_closing_day: e.target.value,
                          billing_cycle_end_day: e.target.value,
                        }))
                      }
                      placeholder="e.g. 15"
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Day of month your statement closes. Used for projected statement balance and
                      interest.
                    </p>
                    {form.statement_closing_day &&
                    Number(form.statement_closing_day) >= 1 &&
                    Number(form.statement_closing_day) <= 31 ? (
                      <p className="mt-1 text-xs text-gray-600">
                        Next cycle ends:{" "}
                        <span className="font-medium tabular-nums">
                          {formatBillingCycleEndPreview(form.statement_closing_day)}
                        </span>
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Payment due day (1–31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={form.payment_due_day}
                      onChange={(e) => setForm((f) => ({ ...f, payment_due_day: e.target.value }))}
                      placeholder="e.g. 10"
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Current balance owed</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.current_balance}
                      onChange={(e) => setForm((f) => ({ ...f, current_balance: e.target.value }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Statement balance</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.statement_balance}
                      onChange={(e) => setForm((f) => ({ ...f, statement_balance: e.target.value }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Minimum payment</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.minimum_payment_amount}
                      onChange={(e) => setForm((f) => ({ ...f, minimum_payment_amount: e.target.value }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="autopay_enabled"
                      checked={form.autopay_enabled}
                      onChange={(e) => setForm((f) => ({ ...f, autopay_enabled: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor="autopay_enabled" className="text-sm font-medium text-gray-700">
                      Autopay enabled
                    </label>
                  </div>
                  {form.autopay_enabled && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Paid from account</label>
                        <select
                          value={form.autopay_account}
                          onChange={(e) => setForm((f) => ({ ...f, autopay_account: e.target.value }))}
                          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                        >
                          <option value="">Select account…</option>
                          {accounts
                            .filter(
                              (a) =>
                                a.id !== editing?.id &&
                                ["CHECKING", "SAVINGS", "CASH"].includes(a.account_type)
                            )
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {getEffectiveDisplayName(a)}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Autopay type</label>
                        <select
                          value={form.autopay_type}
                          onChange={(e) => setForm((f) => ({ ...f, autopay_type: e.target.value }))}
                          className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                        >
                          <option value="minimum_payment">Minimum payment</option>
                          <option value="statement_balance">Statement balance</option>
                          <option value="current_balance">Current balance</option>
                          <option value="fixed_amount">Fixed amount</option>
                          <option value="custom_amount">Custom amount</option>
                        </select>
                      </div>
                      {(form.autopay_type === "fixed_amount" || form.autopay_type === "custom_amount") && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Autopay amount</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={form.autopay_fixed_amount}
                            onChange={(e) => setForm((f) => ({ ...f, autopay_fixed_amount: e.target.value }))}
                            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                          />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setModalOpen(false)} className="py-2 px-4 border rounded" disabled={createMu.isPending || updateMu.isPending}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  disabled={createMu.isPending || updateMu.isPending}
                >
                  {createMu.isPending || updateMu.isPending ? (editing ? "Saving…" : "Creating…") : editing ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
