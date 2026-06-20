import { useState, useMemo, Fragment, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useOperationalAccounts } from "../hooks/useOperationalAccounts";
import { formatCurrency, formatAccountOptionLabel } from "@budget-app/shared";
import type { RecurringRule, Account, Category, RecurringRuleFrequency } from "@budget-app/shared";
import {
  listRules,
  listCategories,
  listHouseholds,
  getProfile,
  createRule,
  updateRule,
  pauseRule as pauseRuleApi,
  resumeRule as resumeRuleApi,
  deleteRule,
} from "@budget-app/api-client";
import RuleActionsMenu from "../components/rules/RuleActionsMenu";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import { formatNextRunDate, getNextRuleRunDate } from "../lib/ruleOccurrences";
import { formatDateDisplay } from "../lib/dateDisplay";

const FREQUENCY_LABELS: Record<RecurringRuleFrequency, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Biweekly",
  MONTHLY_DAY: "Monthly (day)",
  MONTHLY_NTH_WEEKDAY: "Monthly (nth weekday)",
  YEARLY: "Yearly",
};

const WEEKDAYS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

const NTH = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd" },
  { value: 4, label: "4th" },
  { value: 5, label: "5th" },
];

const RULE_SECTIONS = [
  { key: "income", label: "Income" },
  { key: "bills", label: "Bills" },
  { key: "card_loan_payments", label: "Credit Card / Loan Payment" },
  { key: "transfers", label: "Transfers" },
  { key: "subscriptions", label: "Subscriptions" },
] as const;

type RuleSectionKey = (typeof RULE_SECTIONS)[number]["key"];

const SUBSCRIPTION_CATEGORY_NAMES = new Set(["Streaming", "Software / Apps", "Memberships"]);

const CARD_LOAN_PAYMENT_CATEGORY_NAMES = new Set([
  "Credit Card Payment",
  "Student Loan",
  "Personal Loan",
]);

const TRANSFER_CATEGORY_NAMES = new Set(["Bank Transfer", "Transfer"]);

type RuleLifecycleStatus = "running" | "paused" | "ended";

const RULE_LIFECYCLE_OPTIONS: { value: RuleLifecycleStatus; label: string }[] = [
  { value: "running", label: "🟢 Running" },
  { value: "paused", label: "🟡 Paused" },
  { value: "ended", label: "⚫ Ended" },
];

function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getRuleLifecycleStatus(rule: RecurringRule, today = todayLocalISO()): RuleLifecycleStatus {
  const end = rule.end_date?.slice(0, 10);
  if (end && end < today) return "ended";
  if (!rule.active) return "paused";
  return "running";
}

function lifecycleStatusLabel(status: RuleLifecycleStatus): string {
  return RULE_LIFECYCLE_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

function lifecycleToActiveAndEndDate(
  status: RuleLifecycleStatus,
  endDate: string,
  today = todayLocalISO()
): { active: boolean; end_date: string | null } {
  if (status === "running") {
    return { active: true, end_date: endDate && endDate >= today ? endDate : null };
  }
  if (status === "paused") {
    return { active: false, end_date: endDate || null };
  }
  const endedOn = endDate && endDate <= today ? endDate : today;
  return { active: false, end_date: endedOn };
}

function getRuleSection(rule: RecurringRule): RuleSectionKey {
  if (rule.direction === "INCOME") return "income";
  const catName = rule.category?.name ?? "";
  const hasTransferDest = !!(rule.transfer_to_account?.id ?? rule.transfer_to_account_id);
  const nameLower = (rule.name ?? "").toLowerCase();
  if (CARD_LOAN_PAYMENT_CATEGORY_NAMES.has(catName)) return "card_loan_payments";
  if (
    rule.direction === "TRANSFER" ||
    hasTransferDest ||
    TRANSFER_CATEGORY_NAMES.has(catName) ||
    nameLower.includes("move to")
  ) {
    return "transfers";
  }
  if (SUBSCRIPTION_CATEGORY_NAMES.has(catName)) return "subscriptions";
  return "bills";
}

/** Signed monthly equivalent (expenses negative) for running budget subtotals. */
function ruleMonthlyAmount(rule: RecurringRule): number {
  const amount = Math.abs(Number(rule.amount) || 0);
  const interval = Math.max(1, Number(rule.interval) || 1);
  let perMonth: number;
  switch (rule.frequency) {
    case "WEEKLY":
      perMonth = (52 / 12 / interval) * amount;
      break;
    case "BIWEEKLY":
      perMonth = (26 / 12 / interval) * amount;
      break;
    case "MONTHLY_DAY":
    case "MONTHLY_NTH_WEEKDAY":
      perMonth = amount / interval;
      break;
    case "YEARLY":
      perMonth = amount / (12 * interval);
      break;
    default:
      perMonth = amount / interval;
  }
  return rule.direction === "EXPENSE" ? -perMonth : perMonth;
}

function sectionMonthlySubtotal(rules: RecurringRule[]): number {
  return rules.reduce((sum, rule) => {
    if (getRuleLifecycleStatus(rule) !== "running") return sum;
    return sum + ruleMonthlyAmount(rule);
  }, 0);
}

/** Income minus expenses from running rules; excludes internal bank transfers only. */
function estimatedMonthlyCashFlow(rules: RecurringRule[]): number {
  return rules.reduce((sum, rule) => {
    if (getRuleLifecycleStatus(rule) !== "running") return sum;
    if (getRuleSection(rule) === "transfers") return sum;
    return sum + ruleMonthlyAmount(rule);
  }, 0);
}

function formatMonthlySubtotal(total: number, currency = "USD"): string {
  if (total === 0) return formatCurrency(0, currency);
  const prefix = total > 0 ? "+" : "-";
  return `${prefix}${formatCurrency(Math.abs(total), currency)}`;
}

function cadenceSummary(rule: RecurringRule): string {
  const f = rule.frequency;
  if (f === "WEEKLY") {
    const weeks = Math.max(1, Number(rule.interval) || 1);
    return `Every ${weeks} ${weeks === 1 ? "week" : "weeks"} on ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  }
  if (f === "BIWEEKLY") {
    const weeks = Math.max(1, Number(rule.interval) || 1) * 2;
    return `Every ${weeks} ${weeks === 1 ? "week" : "weeks"} on ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  }
  if (f === "MONTHLY_DAY") return `Monthly on day ${rule.day_of_month ?? "?"}`;
  if (f === "MONTHLY_NTH_WEEKDAY") return `Monthly on ${NTH.find((n) => n.value === rule.nth_week)?.label ?? "?"} ${WEEKDAYS.find((w) => w.value === rule.day_of_week)?.label ?? "?"}`;
  if (f === "YEARLY") return `Yearly on ${rule.start_date ? formatDateDisplay(rule.start_date) : "?"}`;
  return rule.frequency;
}

export default function Rules() {
  const [searchParams, setSearchParams] = useSearchParams();
  const openedEditFromUrlRef = useRef<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [ruleSearch, setRuleSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    household: 0 as number,
    account_id: 0 as number,
    transfer_to_account_id: null as number | null,
    category_id: null as number | null,
    direction: "EXPENSE" as "INCOME" | "EXPENSE" | "TRANSFER",
    amount: "",
    currency: "USD",
    frequency: "MONTHLY_DAY" as RecurringRuleFrequency,
    interval: 1,
    day_of_week: null as number | null,
    day_of_month: 15,
    nth_week: null as number | null,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: "" as string,
    lifecycleStatus: "running" as RuleLifecycleStatus,
    notes: "",
    is_bill: false,
    scheduleChangeLater: false,
    changeEffectiveDate: "",
  });
  const queryClient = useQueryClient();

  const { data: rulesData } = useQuery({
    queryKey: ["rules"],
    queryFn: () => listRules(),
    refetchOnMount: "always",
  });
  const { data: accountsData } = useOperationalAccounts();
  const { data: categoriesData } = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });

  const rules = rulesData?.results ?? [];
  const filteredRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter((r: RecurringRule) => (r.name ?? "").toLowerCase().includes(q));
  }, [rules, ruleSearch]);
  const monthlyCashFlow = useMemo(
    () => estimatedMonthlyCashFlow(filteredRules),
    [filteredRules]
  );
  const cashFlowCurrency =
    filteredRules.find((r) => getRuleLifecycleStatus(r) === "running")?.currency ?? "USD";

  const groupedRules = useMemo(() => {
    const groups: Record<RuleSectionKey, RecurringRule[]> = {
      income: [],
      bills: [],
      card_loan_payments: [],
      transfers: [],
      subscriptions: [],
    };
    for (const rule of filteredRules) {
      groups[getRuleSection(rule)].push(rule);
    }
    for (const key of Object.keys(groups) as RuleSectionKey[]) {
      groups[key].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })
      );
    }
    return groups;
  }, [filteredRules]);
  const accounts = accountsData?.results ?? [];
  const categories = categoriesData?.results ?? [];
  const householdId = form.household || (profile?.default_household ?? households?.[0]?.id ?? 0);
  const accountsForHousehold = householdId
    ? accounts.filter((a: Account) => {
        const h = a.household;
        const hid = typeof h === "object" && h != null ? (h as { id: number }).id : h;
        return hid === householdId;
      })
    : accounts;

  function invalidateLedgerQueries() {
    queryClient.invalidateQueries({ queryKey: ["rules"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
    queryClient.invalidateQueries({ queryKey: ["timeline-calendar"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["accounts"] });
  }

  const createMu = useMutation({
    mutationFn: createRule,
    onSuccess: () => {
      invalidateLedgerQueries();
      setModalOpen(false);
      setEditing(null);
      resetForm();
      setSubmitError(null);
    },
    onError: (err: Error) => setSubmitError(err.message || "Failed to create automation"),
  });
  const updateMu = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<RecurringRule> }) => updateRule(id, data),
    onSuccess: () => {
      invalidateLedgerQueries();
      setModalOpen(false);
      setEditing(null);
      setSubmitError(null);
    },
    onError: (err: Error) => setSubmitError(err.message || "Failed to update automation"),
  });
  const deleteMu = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => invalidateLedgerQueries(),
  });
  const pauseMu = useMutation({
    mutationFn: pauseRuleApi,
    onSuccess: () => invalidateLedgerQueries(),
  });
  const resumeMu = useMutation({
    mutationFn: resumeRuleApi,
    onSuccess: () => invalidateLedgerQueries(),
  });

  function resetForm() {
    setForm({
      name: "",
      household: householdId || 0,
      account_id: 0,
      transfer_to_account_id: null,
      category_id: null,
      direction: "EXPENSE",
      amount: "",
      currency: "USD",
      frequency: "MONTHLY_DAY",
      interval: 1,
      day_of_week: null,
      day_of_month: 15,
      nth_week: null,
      start_date: new Date().toISOString().slice(0, 10),
      end_date: "",
      lifecycleStatus: "running",
      notes: "",
      is_bill: false,
      scheduleChangeLater: false,
      changeEffectiveDate: "",
    });
  }

  function openCreate() {
    resetForm();
    setForm((f) => ({ ...f, household: householdId || 0 }));
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(rule: RecurringRule) {
    const sched = rule.scheduled_change;
    const source = sched ?? rule;
    const rawInterval = Math.max(1, Number(source.interval) || 1);
    const normalizedFrequency: RecurringRuleFrequency =
      source.frequency === "BIWEEKLY" ? "WEEKLY" : (source.frequency as RecurringRuleFrequency);
    const normalizedInterval =
      source.frequency === "BIWEEKLY" ? rawInterval * 2 : rawInterval;
    setEditing(rule);
    setForm({
      name: rule.name,
      household: typeof rule.household === "object" ? (rule.household as { id: number }).id : rule.household,
      account_id:
        sched?.account_id ??
        rule.account?.id ??
        (rule as { account_id?: number }).account_id ??
        0,
      transfer_to_account_id:
        sched?.transfer_to_account_id ??
        rule.transfer_to_account?.id ??
        (rule as { transfer_to_account_id?: number }).transfer_to_account_id ??
        null,
      category_id:
        sched?.category_id ??
        rule.category?.id ??
        (rule as { category_id?: number }).category_id ??
        null,
      direction: (sched?.direction ?? rule.direction) as "INCOME" | "EXPENSE" | "TRANSFER",
      amount: sched?.amount ?? rule.amount,
      currency: sched?.currency ?? (rule.currency || "USD"),
      frequency: normalizedFrequency,
      interval: normalizedInterval,
      day_of_week: source.day_of_week ?? null,
      day_of_month: source.day_of_month ?? 15,
      nth_week: source.nth_week ?? null,
      start_date: (sched?.start_date ?? rule.start_date)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      end_date: (sched?.end_date ?? rule.end_date)?.slice(0, 10) ?? "",
      lifecycleStatus: getRuleLifecycleStatus(rule),
      notes: rule.notes ?? "",
      is_bill: rule.is_bill ?? false,
      scheduleChangeLater: !!sched,
      changeEffectiveDate: sched?.effective_from?.slice(0, 10) ?? "",
    });
    setModalOpen(true);
  }

  useEffect(() => {
    if (!modalOpen) openedEditFromUrlRef.current = null;
  }, [modalOpen]);

  useEffect(() => {
    const editParam = searchParams.get("edit");
    if (!editParam || rules.length === 0) return;
    const id = Number(editParam);
    if (!Number.isFinite(id) || openedEditFromUrlRef.current === id) return;
    const rule = rules.find((r) => r.id === id);
    if (!rule) return;
    openedEditFromUrlRef.current = id;
    openEdit(rule);
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  }, [rules, searchParams, setSearchParams]);

  function pauseRule(rule: RecurringRule) {
    if (getRuleLifecycleStatus(rule) !== "running") return;
    pauseMu.mutate(rule.id);
  }

  function resumeRule(rule: RecurringRule) {
    if (getRuleLifecycleStatus(rule) !== "paused") return;
    resumeMu.mutate(rule.id);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const selectedCat = categories.find((c: Category) => c.id === form.category_id);
    const catName = selectedCat?.name ?? "";
    const transferAllowed =
      catName === "Credit Card Payment" || catName === "Bank Transfer";
    const { active, end_date } = lifecycleToActiveAndEndDate(form.lifecycleStatus, form.end_date);
    const wasPaused = editing ? getRuleLifecycleStatus(editing) === "paused" : false;
    const today = todayLocalISO();
    const payload: Record<string, unknown> = {
      household: form.household || householdId,
      name: form.name,
      account_id: form.account_id,
      transfer_to_account_id: transferAllowed ? (form.transfer_to_account_id ?? null) : null,
      category_id: form.category_id,
      direction: form.direction,
      amount: form.amount,
      currency: form.currency,
      frequency: form.frequency,
      interval: form.interval,
      day_of_week: form.day_of_week,
      day_of_month: form.frequency === "MONTHLY_DAY" || form.frequency === "MONTHLY_NTH_WEEKDAY" ? form.day_of_month : undefined,
      nth_week: form.frequency === "MONTHLY_NTH_WEEKDAY" ? form.nth_week : undefined,
      start_date: form.start_date,
      end_date,
      active,
      notes: form.notes || null,
      is_bill: form.is_bill,
    };
    if (editing) {
      if (form.scheduleChangeLater) {
        const eff = form.changeEffectiveDate?.slice(0, 10);
        if (!eff || eff <= today) {
          setSubmitError("Choose an effective date after today to schedule a later change.");
          return;
        }
        payload.change_effective_date = eff;
      }
      const runUpdate = () =>
        updateMu.mutate({ id: editing.id, data: payload as Partial<RecurringRule> });
      if (form.lifecycleStatus === "running" && wasPaused) {
        resumeMu.mutate(editing.id, { onSuccess: runUpdate });
      } else if (form.lifecycleStatus === "paused" && !wasPaused) {
        pauseMu.mutate(editing.id, { onSuccess: runUpdate });
      } else {
        runUpdate();
      }
    } else {
      createMu.mutate(payload as Parameters<typeof createRule>[0]);
    }
  }

  return (
    <div className={PAGE_SHELL_PY}>
      <div
        className={`mb-4 grid gap-3 ${
          rules.length > 0 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {rules.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800">Estimated monthly cash flow</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Running automation only. Includes income, bills, subscriptions, and card or loan payments.
                  Excludes internal transfers between checking and savings.
                </p>
              </div>
              <p
                className={`shrink-0 text-xl font-semibold tabular-nums ${
                  monthlyCashFlow > 0
                    ? "text-green-600"
                    : monthlyCashFlow < 0
                      ? "text-red-600"
                      : "text-gray-600"
                }`}
              >
                {formatMonthlySubtotal(monthlyCashFlow, cashFlowCurrency)}
                <span className="text-sm font-normal text-gray-500 ml-1">/ mo</span>
              </p>
            </div>
          </div>
        )}
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            placeholder="Search automation by name..."
            value={ruleSearch}
            onChange={(e) => setRuleSearch(e.target.value)}
            className="flex-1 min-w-0 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={openCreate}
            className="shrink-0 self-end sm:self-auto rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add automation
          </button>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full w-full table-fixed divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[32%]">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[14%]">From Account</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[10%]">Amount</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[18%]">Cadence</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[10%]">Next Run</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[10%]">Status</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-[6%]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {RULE_SECTIONS.map(({ key, label }) => {
              const sectionRules = groupedRules[key];
              if (sectionRules.length === 0) return null;
              const monthlySubtotal = sectionMonthlySubtotal(sectionRules);
              const subtotalCurrency =
                sectionRules.find((r) => getRuleLifecycleStatus(r) === "running")?.currency ?? "USD";
              return (
                <Fragment key={key}>
                  <tr className="bg-gray-100">
                    <td
                      colSpan={7}
                      className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <span>{label}</span>
                        <span
                          className={`normal-case tracking-normal text-sm font-semibold tabular-nums ${
                            monthlySubtotal < 0
                              ? "text-red-600"
                              : monthlySubtotal > 0
                                ? "text-green-600"
                                : "text-gray-500"
                          }`}
                        >
                          <span className="text-gray-500 font-medium mr-1.5">Monthly</span>
                          {formatMonthlySubtotal(monthlySubtotal, subtotalCurrency)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {sectionRules.map((rule: RecurringRule) => {
                    const lifecycle = getRuleLifecycleStatus(rule);
                    const nextRun =
                      lifecycle === "running" ? getNextRuleRunDate(rule, todayLocalISO()) : null;
                    return (
                    <tr key={rule.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm min-w-0">
                        <span className="block truncate" title={rule.name}>
                          {rule.name}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm">{rule.account?.name ?? "-"}</td>
                      <td className="px-4 py-2 text-sm">
                        <span className={rule.direction === "EXPENSE" ? "text-red-600" : "text-green-600"}>
                          {rule.direction === "EXPENSE" ? "-" : "+"}
                          {formatCurrency(rule.amount, rule.currency)}
                        </span>
                        {rule.scheduled_change && (
                          <p className="text-xs text-amber-700 mt-0.5">
                            → {formatCurrency(rule.scheduled_change.amount, rule.scheduled_change.currency)} on{" "}
                            {formatDateDisplay(rule.scheduled_change.effective_from)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">{cadenceSummary(rule)}</td>
                      <td className="px-4 py-2 text-sm text-gray-700 whitespace-nowrap">
                        {formatNextRunDate(nextRun)}
                      </td>
                      <td className="px-4 py-2 text-sm whitespace-nowrap">
                        {lifecycleStatusLabel(lifecycle)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex justify-end">
                          <RuleActionsMenu
                            onEdit={() => openEdit(rule)}
                            onPause={
                              lifecycle === "running"
                                ? () => pauseRule(rule)
                                : undefined
                            }
                            onResume={
                              lifecycle === "paused"
                                ? () => resumeRule(rule)
                                : undefined
                            }
                            onDelete={() => {
                              if (window.confirm("Delete this automation?")) deleteMu.mutate(rule.id);
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rules.length === 0 && (
          <p className="px-4 py-8 text-center text-gray-500">No automation yet. Add one to project recurring income or expenses.</p>
        )}
        {rules.length > 0 && filteredRules.length === 0 && (
          <p className="px-4 py-8 text-center text-gray-500">No automation matches &quot;{ruleSearch}&quot;.</p>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b font-medium">{editing ? "Edit automation" : "New automation"}</div>
            {editing && (
              <p className="px-4 pt-2 text-xs text-gray-500 bg-amber-50 border-b border-amber-100">
                Changes apply to future occurrences only; past ledger rows stay as-is. Use &quot;Schedule for later&quot;
                to keep the current amount until a specific date (e.g. a raise starting in July).
              </p>
            )}
            <form onSubmit={handleSubmit} className="p-4 space-y-3">
              {submitError && <p className="text-red-600 text-sm">{submitError}</p>}
              <div>
                <label className="block text-sm font-medium text-gray-700">Household</label>
                <select
                  value={form.household || ""}
                  onChange={(e) => setForm((f) => ({ ...f, household: Number(e.target.value) }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  required
                >
                  <option value="">Select</option>
                  {(households ?? []).map((h: { id: number; name: string }) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">From Account</label>
                <select
                  value={form.account_id || ""}
                  onChange={(e) => setForm((f) => ({ ...f, account_id: Number(e.target.value) }))}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  required
                >
                  <option value="">Select</option>
                  {accountsForHousehold.map((a: Account) => (
                    <option key={a.id} value={a.id}>
                      {formatAccountOptionLabel(a)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Category</label>
                <select
                  value={form.category_id ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      category_id: e.target.value ? Number(e.target.value) : null,
                      transfer_to_account_id: null,
                    }))
                  }
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  <option value="">None</option>
                  {categories
                    .filter((c: Category) => (c.household as number) === (form.household || householdId))
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }))
                    .map((c: Category) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
              </div>
              {(() => {
                const selectedCategory = categories.find((c: Category) => c.id === form.category_id);
                const isCreditCardPayment = selectedCategory?.name === "Credit Card Payment";
                const isBankTransfer = selectedCategory?.name === "Bank Transfer";
                const creditCardAccounts = accountsForHousehold.filter(
                  (a: Account) => a.account_type === "CREDIT" && a.id !== form.account_id
                );
                const otherAccountsForTransfer = accountsForHousehold.filter(
                  (a: Account) => a.id !== form.account_id
                );
                if (isCreditCardPayment && creditCardAccounts.length > 0) {
                  return (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Pay to account (credit card)</label>
                      <select
                        value={form.transfer_to_account_id ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            transfer_to_account_id: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Select credit card</option>
                        {creditCardAccounts.map((a: Account) => (
                          <option key={a.id} value={a.id}>
                            {formatAccountOptionLabel(a)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-0.5 text-xs text-gray-500">
                        This will create a transfer: expense from the account above, payment into the selected card.
                      </p>
                    </div>
                  );
                }
                if (isBankTransfer && otherAccountsForTransfer.length > 0) {
                  return (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Transfer to account</label>
                      <select
                        value={form.transfer_to_account_id ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            transfer_to_account_id: e.target.value ? Number(e.target.value) : null,
                          }))
                        }
                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        required
                      >
                        <option value="">Select destination account</option>
                        {otherAccountsForTransfer.map((a: Account) => (
                          <option key={a.id} value={a.id}>
                            {formatAccountOptionLabel(a)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Money moves from the account above to this account.
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700">Direction</label>
                  <select
                    value={form.direction}
                    onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as "INCOME" | "EXPENSE" | "TRANSFER" }))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="INCOME">Income</option>
                    <option value="EXPENSE">Expense</option>
                    <option value="TRANSFER">Transfer</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700">Amount</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
                    required
                  />
                </div>
              </div>
              {editing && (
                <div className="rounded border border-gray-200 bg-gray-50 p-3 space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.scheduleChangeLater}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          scheduleChangeLater: e.target.checked,
                          changeEffectiveDate: e.target.checked ? f.changeEffectiveDate : "",
                        }))
                      }
                      className="rounded border-gray-300"
                    />
                    Schedule amount/cadence change for later (keep current until then)
                  </label>
                  {form.scheduleChangeLater && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Effective on</label>
                      <input
                        type="date"
                        min={(() => {
                          const d = new Date();
                          d.setDate(d.getDate() + 1);
                          return d.toISOString().slice(0, 10);
                        })()}
                        value={form.changeEffectiveDate}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, changeEffectiveDate: e.target.value }))
                        }
                        className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        required
                      />
                      <p className="mt-0.5 text-xs text-gray-500">
                        Until this date, forecasts use{" "}
                        {formatCurrency(editing.amount, editing.currency)}. From this date onward, they use the
                        values above.
                      </p>
                    </div>
                  )}
                  {editing.scheduled_change && (
                    <button
                      type="button"
                      className="text-sm text-red-600 hover:underline"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `Remove scheduled change on ${formatDateDisplay(editing.scheduled_change!.effective_from)}?`
                          )
                        ) {
                          return;
                        }
                        updateMu.mutate({
                          id: editing.id,
                          data: { cancel_scheduled_change: true } as Partial<RecurringRule>,
                        });
                      }}
                    >
                      Remove scheduled change
                    </button>
                  )}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">Frequency</label>
                <select
                  value={form.frequency}
                  onChange={(e) => {
                    const freq = e.target.value as RecurringRuleFrequency;
                    setForm((f) => {
                      const next = { ...f, frequency: freq };
                      if (freq === "WEEKLY" && f.start_date) {
                        const d = new Date(f.start_date + "T12:00:00");
                        next.day_of_week = (d.getDay() + 6) % 7;
                      }
                      return next;
                    });
                  }}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {Object.entries(FREQUENCY_LABELS)
                    .filter(([k]) => k !== "BIWEEKLY")
                    .map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              {form.frequency === "WEEKLY" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Every how many weeks?</label>
                    <input
                      type="number"
                      min={1}
                      max={52}
                      value={form.interval}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          interval: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <p className="mt-0.5 text-xs text-gray-500">
                      Example: 2 = every other week, 3 = every 3 weeks.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Day of week</label>
                    <select
                      value={form.day_of_week ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, day_of_week: e.target.value ? Number(e.target.value) : null }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {WEEKDAYS.map((w) => (
                        <option key={w.value} value={w.value}>{w.label}</option>
                      ))}
                    </select>
                    <p className="mt-0.5 text-xs text-gray-500">First occurrence is this weekday on or after the start date.</p>
                  </div>
                </>
              )}
              {form.frequency === "MONTHLY_DAY" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">Day of month (1–31)</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.day_of_month ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, day_of_month: e.target.value ? Number(e.target.value) : 15 }))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              )}
              {form.frequency === "MONTHLY_NTH_WEEKDAY" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Nth weekday (e.g. 2nd)</label>
                    <select
                      value={form.nth_week ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, nth_week: e.target.value ? Number(e.target.value) : null }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {NTH.map((n) => (
                        <option key={n.value} value={n.value}>{n.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Weekday</label>
                    <select
                      value={form.day_of_week ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, day_of_week: e.target.value ? Number(e.target.value) : null }))}
                      className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {WEEKDAYS.map((w) => (
                        <option key={w.value} value={w.value}>{w.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Start date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => {
                        const next = { ...f, start_date: v };
                        if (f.frequency === "WEEKLY" && v) {
                          const d = new Date(v + "T12:00:00");
                          next.day_of_week = (d.getDay() + 6) % 7;
                        }
                        return next;
                      });
                    }}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">End date (optional)</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="rule-is-bill"
                  type="checkbox"
                  checked={form.is_bill}
                  onChange={(e) => setForm((f) => ({ ...f, is_bill: e.target.checked }))}
                  className="mt-1 rounded border-gray-300"
                />
                <label htmlFor="rule-is-bill" className="text-sm text-gray-700">
                  <span className="font-medium">Include on monthly bill checklist</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Use for required transfers (e.g. savings) that should appear as bills.
                  </span>
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  placeholder="Optional reminders (e.g. autopay, annual review, why amount changed)"
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm resize-y min-h-[4.5rem]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status</label>
                <select
                  value={form.lifecycleStatus}
                  onChange={(e) => {
                    const status = e.target.value as RuleLifecycleStatus;
                    const today = todayLocalISO();
                    setForm((f) => {
                      const next = { ...f, lifecycleStatus: status };
                      if (status === "running" && f.end_date && f.end_date < today) {
                        next.end_date = "";
                      }
                      if (status === "ended" && (!f.end_date || f.end_date > today)) {
                        next.end_date = today;
                      }
                      return next;
                    });
                  }}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {RULE_LIFECYCLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-xs text-gray-500">
                  {form.lifecycleStatus === "running" &&
                    "Projects future transactions on the timeline."}
                  {form.lifecycleStatus === "paused" &&
                    "Temporarily stopped; no new projected transactions until resumed."}
                  {form.lifecycleStatus === "ended" &&
                    "Schedule finished. Uses the end date below (defaults to today)."}
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="px-3 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">
                  {editing ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
