import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { getBillsOverview, getRecurringRulesSummary, getSubscriptionIntelligence, listRules } from "@budget-app/api-client";
import { formatCurrency } from "@budget-app/shared";
import RecurringDetailPanel from "../components/recurring/RecurringDetailPanel";
import { useOperationalAccounts } from "../hooks/useOperationalAccounts";
import { currentMonthKey } from "../lib/billsDisplay";
import {
  buildRecurringListItems,
  formatRecurringDate,
  groupRecurringItemsByDay,
  mapRecurringBackendSummary,
  recurringPaymentStatusBadgeClass,
  recurringPaymentStatusLabel,
  recurringPaymentRowAccentClass,
  recurringPaymentRowClass,
  recurringTrendLabel,
  type RecurringPaymentStatus,
  type RecurringListItem,
  type RecurringSummary,
} from "../lib/recurringDisplay";
import DashboardMetricTile from "../components/dashboard/DashboardMetricTile";
import {
  METRIC_TILE_GRID_5,
  METRIC_TILE_SKELETON_CLASS,
} from "../components/dashboard/metricTileLayout";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import { RECURRING_SUMMARY } from "../lib/recurringTerminology";
import SubscriptionIntelligencePanel from "../components/recurring/SubscriptionIntelligencePanel";
import {
  AUTOMATION_NAV_LABEL,
  AUTOMATION_PATH,
  RECURRING_PAGE_INTRO,
} from "../lib/automationDisplay";

const STATUS_FILTER_OPTIONS: { value: "" | RecurringPaymentStatus; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "scheduled", label: "Scheduled" },
  { value: "due_soon", label: "Due soon" },
  { value: "paid", label: "Paid" },
  { value: "missed", label: "Missed" },
  { value: "skipped", label: "Skipped" },
  { value: "paused", label: "Paused" },
  { value: "inactive", label: "Inactive" },
];

function SummaryBar({ summary }: { summary: RecurringSummary }) {
  const metrics = [
    {
      ...RECURRING_SUMMARY.activeRules,
      value: String(summary.activeRules),
    },
    {
      ...RECURRING_SUMMARY.monthlyObligations,
      value: formatCurrency(summary.monthlyRecurringTotal),
    },
    {
      ...RECURRING_SUMMARY.upcomingCharges,
      value: String(summary.upcomingCount),
    },
    {
      ...RECURRING_SUMMARY.missedPayments,
      value: String(summary.missedCount),
    },
    {
      ...RECURRING_SUMMARY.dueSoon,
      value: String(summary.dueSoonCount),
    },
  ];

  return (
    <div className={METRIC_TILE_GRID_5}>
      {metrics.map((m) => (
        <DashboardMetricTile key={m.label} label={m.label} help={m.help} value={m.value} />
      ))}
    </div>
  );
}

function SummaryBarSkeleton() {
  return (
    <div className={METRIC_TILE_GRID_5}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={METRIC_TILE_SKELETON_CLASS} aria-hidden />
      ))}
    </div>
  );
}

function SummaryBarError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5 flex flex-wrap items-center gap-2 justify-between">
      <p className="text-sm text-red-700">Could not load recurring summary</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm font-medium text-red-800 underline hover:no-underline"
      >
        Retry
      </button>
    </div>
  );
}

function RecurringRow({
  item,
  onSelect,
}: {
  item: RecurringListItem;
  onSelect: (item: RecurringListItem) => void;
}) {
  const { rule } = item;
  const trend = recurringTrendLabel(item.trend);

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left flex hover:bg-gray-50/80 transition ${recurringPaymentRowClass(item.paymentStatus)}`}
    >
      <span
        className={`w-1.5 shrink-0 self-stretch ${recurringPaymentRowAccentClass(item.paymentStatus)}`}
        aria-hidden
      />
      <div className="flex-1 min-w-0 px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate">{rule.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {item.cadenceLabel}
            {item.categorySubtitle ? ` · ${item.categorySubtitle}` : ""}
          </div>
          <div className="text-xs text-gray-500 mt-1 sm:hidden">
            {rule.account.effective_display_name ?? rule.account.name}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 sm:shrink-0">
          <span className="hidden sm:inline shrink-0 max-w-[10rem] lg:max-w-[14rem] truncate">
            {rule.account.effective_display_name ?? rule.account.name}
          </span>
          <span className="tabular-nums shrink-0">
            Avg {item.averageAmount ? formatCurrency(item.averageAmount) : formatCurrency(rule.amount)}
          </span>
          <span className="shrink-0">Last {formatRecurringDate(item.lastPaidDate)}</span>
          <span className="shrink-0">Next {formatRecurringDate(item.nextOccurrence)}</span>
          {trend && <span className="text-gray-400 shrink-0">{trend}</span>}
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <span
            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${recurringPaymentStatusBadgeClass(item.paymentStatus)}`}
          >
            {recurringPaymentStatusLabel(item.paymentStatus)}
          </span>
          {item.autopayLabel && (
            <span className="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
              Auto
            </span>
          )}
          {!rule.active && (
            <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Off</span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function Recurring() {
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") || currentMonthKey();
  const accountFilter = searchParams.get("account") || "";
  const statusFilter = (searchParams.get("status") || searchParams.get("health") || "") as
    | RecurringPaymentStatus
    | "";
  const search = (searchParams.get("q") || "").trim().toLowerCase();

  const [selected, setSelected] = useState<RecurringListItem | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const { data: accountsData } = useOperationalAccounts();
  const accounts = accountsData?.results ?? [];

  const rulesQuery = useQuery({
    queryKey: ["recurring-rules"],
    queryFn: () => listRules(),
  });

  const summaryQuery = useQuery({
    queryKey: ["recurring-rules-summary"],
    queryFn: () => getRecurringRulesSummary(),
  });

  const overviewQuery = useQuery({
    queryKey: ["bills-overview", month, "recurring"],
    queryFn: () =>
      getBillsOverview({
        month,
        months_before: 0,
        months_after: 0,
      }),
  });

  const subscriptionsQuery = useQuery({
    queryKey: ["subscription-intelligence"],
    queryFn: () => getSubscriptionIntelligence(),
  });

  const rules = rulesQuery.data?.results ?? [];
  const checklistItems = overviewQuery.data?.checklist.items ?? [];

  const allItems = useMemo(
    () => buildRecurringListItems(rules, checklistItems),
    [rules, checklistItems]
  );

  const summary = useMemo(
    () => (summaryQuery.data ? mapRecurringBackendSummary(summaryQuery.data) : null),
    [summaryQuery.data]
  );

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (accountFilter && String(item.rule.account.id) !== accountFilter) return false;
      if (statusFilter && item.paymentStatus !== statusFilter) return false;
      if (search && !item.rule.name.toLowerCase().includes(search)) return false;
      return true;
    });
  }, [allItems, accountFilter, statusFilter, search]);

  const grouped = useMemo(() => groupRecurringItemsByDay(filteredItems), [filteredItems]);

  const selectedItem = useMemo(() => {
    if (!selected) return null;
    return allItems.find((item) => item.rule.id === selected.rule.id) ?? selected;
  }, [selected, allItems]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  function handleSelectSubscriptionRule(ruleId: number) {
    const match = allItems.find((item) => item.rule.id === ruleId);
    if (match) setSelected(match);
  }

  const listLoading = rulesQuery.isLoading || overviewQuery.isLoading;
  const summaryLoading = summaryQuery.isLoading || (summaryQuery.isFetching && !summaryQuery.data);
  const summaryFailed = summaryQuery.isError && !summaryQuery.data;

  return (
    <div className={`${PAGE_SHELL_PY} space-y-3`}>
      {summaryFailed ? (
        <SummaryBarError onRetry={() => void summaryQuery.refetch()} />
      ) : summaryLoading || !summary ? (
        <SummaryBarSkeleton />
      ) : (
        <SummaryBar summary={summary} />
      )}

      <SubscriptionIntelligencePanel
        data={subscriptionsQuery.data}
        loading={subscriptionsQuery.isLoading}
        onSelectRule={handleSelectSubscriptionRule}
      />

      <div className="space-y-2">
        <div className="space-y-0.5">
          <p className="text-sm text-gray-500">
            {RECURRING_PAGE_INTRO} Use{" "}
            <Link to={AUTOMATION_PATH} className="text-blue-600 hover:underline">
              {AUTOMATION_NAV_LABEL}
            </Link>{" "}
            to change the rules that create these patterns.
          </p>
          <p className="text-xs text-gray-400">
            For day-by-day balances and risk timing, use{" "}
            <Link to="/timeline" className="text-blue-600 hover:underline">
              Calendar
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="search"
            placeholder="Search merchants…"
            value={searchParams.get("q") || ""}
            onChange={(e) => updateParam("q", e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm min-w-[10rem]"
          />
          <select
            value={accountFilter}
            onChange={(e) => updateParam("account", e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.effective_display_name ?? a.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => updateParam("status", e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm bg-white"
          >
            {STATUS_FILTER_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Link to="/automation" className="text-sm text-blue-600 hover:underline ml-auto">
            Automation settings →
          </Link>
        </div>
      </div>

      {listLoading && <p className="text-sm text-gray-500">Loading recurring obligations…</p>}

      {!listLoading && grouped.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-600">No recurring rules match your filters.</p>
          <Link to="/automation" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
            Add a recurring rule
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4">
        {grouped.map((section) => (
          <section key={section.day} className="min-w-0">
            <h2 className="text-sm font-bold text-gray-900 tracking-wide border-b border-gray-200 pb-1 mb-1">
              {section.label}
              <span className="ml-2 text-xs font-normal text-gray-500">{section.items.length}</span>
            </h2>
            <div className="rounded-lg border border-gray-200 overflow-hidden divide-y divide-gray-100">
              {section.items.map((item) => (
                <RecurringRow key={item.rule.id} item={item} onSelect={setSelected} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {selectedItem && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => {
              if (!linkModalOpen) setSelected(null);
            }}
            aria-hidden
          />
          <RecurringDetailPanel
            item={selectedItem}
            month={month}
            checklistItems={checklistItems}
            onClose={() => setSelected(null)}
            onLinkModalOpenChange={setLinkModalOpen}
          />
        </>
      )}
    </div>
  );
}
