import { useState } from "react";
import { formatCurrency, getAccountInstitutionSubtitle, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, AccountRole } from "@budget-app/shared";
import AccountBucketsModal from "../goals/AccountBucketsModal";
import AccountHealthBadge from "../AccountHealthBadge";
import { AccountRoleBadge } from "../AccountRoleBadge";
import {
  safeToSpendLabel,
  showSafeToSpendForRole,
  type PassiveForecastDays,
} from "../../lib/safeToSpendLabels";
import {
  accountLifecycleStatus,
  type AccountLayoutMode,
} from "../../lib/accountOrganization";
import AccountQuickActions from "../quickActions/AccountQuickActions";
import type { QuickActionDef, QuickActionsContext } from "../../lib/accountQuickActions";
import {
  buildAccountListHealthReason,
  formatLowestProjectedWindowLine,
} from "../../lib/accountHealthDisplay";
import { accountShowsResolveRisk } from "../../lib/resolveRiskDisplay";
import { formatDateDisplay } from "../transactions/transactionsLedgerUtils";

type Props = {
  account: Account;
  role: AccountRole;
  layoutMode: AccountLayoutMode;
  forecastDays: PassiveForecastDays;
  isDefault: boolean;
  showReorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  reorderPending: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetPrimary: () => void;
  onEdit: () => void;
  onClearLedger: () => void;
  onDelete: () => void;
  onArchive: () => void;
  onClose: () => void;
  onRestore: () => void;
  onToggleForecast: (included: boolean) => void;
  onToggleActive: (active: boolean) => void;
  setPrimaryPending: boolean;
  updatePending: boolean;
  quickActionsContext?: QuickActionsContext;
  onQuickAction?: (account: Account, action: QuickActionDef) => void;
  onResolveRisk?: (account: Account) => void;
  isHighlighted?: boolean;
};

export default function AccountListItem({
  account: acc,
  role,
  layoutMode,
  forecastDays,
  isDefault,
  showReorder,
  canMoveUp,
  canMoveDown,
  reorderPending,
  onMoveUp,
  onMoveDown,
  onSetPrimary,
  onEdit,
  onClearLedger,
  onDelete,
  onArchive,
  onClose,
  onRestore,
  onToggleForecast,
  onToggleActive,
  setPrimaryPending,
  updatePending,
  quickActionsContext,
  onQuickAction,
  onResolveRisk,
  isHighlighted = false,
}: Props) {
  const [bucketsOpen, setBucketsOpen] = useState(false);
  const bucketReserve = acc.forecast_summary?.bucket_allocation;
  const hasBucketReserve =
    bucketReserve != null && parseFloat(bucketReserve) > 0;
  const lifecycle = accountLifecycleStatus(acc);
  const isMuted = lifecycle !== "active";
  const isCredit = acc.account_type === "CREDIT";
  const healthStatus = acc.health_status ?? acc.risk_status;
  const healthReason = acc.health_reason ?? acc.risk_reason;
  const showSafe = showSafeToSpendForRole(role, acc.account_type);
  const padding =
    layoutMode === "compact" ? "px-3 py-2" : layoutMode === "detailed" ? "px-4 py-4" : "px-4 py-3";

  const primaryBalance = isCredit
    ? acc.balance_owed != null
      ? formatCurrency(acc.balance_owed, acc.currency)
      : acc.available_credit != null
        ? formatCurrency(acc.available_credit, acc.currency)
        : "—"
    : acc.available_balance != null
      ? formatCurrency(acc.available_balance, acc.currency)
      : "—";

  const primaryLabel = isCredit ? (acc.balance_owed != null ? "Owed" : "Available") : "Balance";
  const targetUtil = parseFloat(acc.target_utilization_percent ?? "10");
  const utilAboveTarget =
    acc.utilization_percent != null && parseFloat(acc.utilization_percent) > targetUtil;

  const listHealthReason =
    healthStatus != null ? buildAccountListHealthReason(healthReason, acc) : null;
  const healthCoversProjection =
    listHealthReason?.includes("Projected balance drops") ||
    listHealthReason?.includes("Projected balance falls");
  const projectionLineText =
    layoutMode !== "compact" && !healthCoversProjection
      ? formatLowestProjectedWindowLine(getEffectiveDisplayName(acc), acc, forecastDays)
      : null;

  const institutionLine =
    layoutMode !== "compact" ? getAccountInstitutionSubtitle(acc) : null;
  const purposeText = layoutMode !== "compact" ? acc.purpose?.trim() : "";
  const showMetaLine = Boolean(institutionLine || purposeText);

  const metricsBlock = (
    <div className="shrink-0 text-right max-w-full">
      {isCredit && layoutMode !== "compact" ? (
        <CreditMetricsGrid
          acc={acc}
          utilAboveTarget={utilAboveTarget}
        />
      ) : (
        <div className="flex flex-wrap items-end justify-end gap-x-3 gap-y-1">
          <MetricBlock label={primaryLabel} value={primaryBalance} />
          {showSafe && acc.available_to_spend != null && layoutMode !== "compact" ? (
            <MetricBlock
              label={safeToSpendLabel(role)}
              value={formatCurrency(acc.available_to_spend, acc.currency)}
              valueClass={
                parseFloat(acc.available_to_spend) < 0 ? "text-red-700" : "text-emerald-800"
              }
              testId="safe-to-spend"
            />
          ) : null}
          {layoutMode !== "compact" && hasBucketReserve ? (
            <MetricBlock
              label="Allocated"
              value={formatCurrency(bucketReserve!, acc.currency)}
              valueClass="text-indigo-800"
              testId="bucket-allocation"
            />
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <>
    <article
      className={`${padding} transition-all duration-300 ${
        isHighlighted
          ? "ring-2 ring-blue-600 ring-inset bg-blue-50 shadow-md z-[1] relative"
          : "hover:bg-gray-50/80"
      } ${isMuted ? "opacity-75 bg-gray-50/50" : ""}`}
      data-testid={`account-row-${acc.id}`}
      data-highlighted={isHighlighted ? "true" : undefined}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 min-w-0">
        {showReorder ? (
          <div className="flex sm:flex-col items-center gap-0.5 shrink-0 order-first sm:order-none">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp || reorderPending}
              className="p-1.5 rounded text-gray-500 hover:bg-gray-200 disabled:opacity-40 touch-manipulation"
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown || reorderPending}
              className="p-1.5 rounded text-gray-500 hover:bg-gray-200 disabled:opacity-40 touch-manipulation"
              aria-label="Move down"
            >
              ↓
            </button>
          </div>
        ) : null}

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 w-full min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              <h3 className="font-medium text-gray-900 truncate">{getEffectiveDisplayName(acc)}</h3>
              <AccountRoleBadge role={role} compact />
              {lifecycle !== "active" ? (
                <LifecycleBadge status={lifecycle} closedAt={acc.closed_at} />
              ) : null}
              {isDefault ? (
                <span className="text-xs text-amber-600 font-medium">Default</span>
              ) : null}
              {showMetaLine ? (
                <span
                  className="text-xs text-gray-500 truncate hidden sm:inline min-w-0 max-w-full"
                  data-testid="account-meta-line"
                  title={[institutionLine, purposeText].filter(Boolean).join(" · ")}
                >
                  {institutionLine ? <span>{institutionLine}</span> : null}
                  {institutionLine && purposeText ? (
                    <span className="text-gray-300 mx-1.5" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  {purposeText ? <span className="text-gray-600">{purposeText}</span> : null}
                </span>
              ) : null}
            </div>

            <div className="shrink-0 flex justify-end">{metricsBlock}</div>
          </div>

          {showMetaLine ? (
            <p
              className="text-xs text-gray-500 truncate sm:hidden -mt-1"
              data-testid="account-meta-line-mobile"
            >
              {institutionLine}
              {institutionLine && purposeText ? " · " : null}
              {purposeText ? <span className="text-gray-600">{purposeText}</span> : null}
            </p>
          ) : null}

          <div className="space-y-1 min-w-0">
            {healthStatus ? (
              <div className="flex flex-wrap items-start gap-2">
                <AccountHealthBadge
                  status={healthStatus}
                  reason={healthReason}
                  account={acc}
                  compact={layoutMode === "compact"}
                  inline
                  alwaysExpandedInline
                />
                {accountShowsResolveRisk(acc) && onResolveRisk && (
                  <button
                    type="button"
                    onClick={() => onResolveRisk(acc)}
                    className="inline-flex rounded-md bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-blue-700 shrink-0"
                  >
                    Resolve risk
                  </button>
                )}
              </div>
            ) : null}

            {projectionLineText ? (
              <p className="text-xs text-gray-600">{projectionLineText}</p>
            ) : null}

            {isCredit && acc.payoff_estimate?.label ? (
              <p className="text-xs text-indigo-700" data-testid="credit-payoff-estimate">
                {acc.payoff_estimate.label}
              </p>
            ) : null}

            {layoutMode === "detailed" && isCredit ? <CreditDetails acc={acc} /> : null}

            {hasBucketReserve && layoutMode !== "compact" ? (
              <button
                type="button"
                onClick={() => setBucketsOpen(true)}
                className="text-xs text-indigo-700 hover:underline"
                data-testid="view-buckets"
              >
                View goal buckets
              </button>
            ) : null}

            {layoutMode === "detailed" ? (
              <div className="flex flex-wrap gap-3 text-xs text-gray-600 pt-1">
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={acc.include_in_forecast !== false}
                    onChange={(e) => onToggleForecast(e.target.checked)}
                    disabled={updatePending}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  In forecast
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={acc.archived !== true}
                    onChange={(e) => onToggleActive(e.target.checked)}
                    disabled={updatePending}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  Active
                </label>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {quickActionsContext && onQuickAction ? (
        <div
          className={`flex flex-wrap items-end justify-between gap-x-3 gap-y-2 ${
            layoutMode === "compact" ? "mt-2" : "mt-3 pt-3 border-t border-gray-100"
          }`}
        >
          <div className="min-w-0 flex-1">
            <AccountQuickActions
              account={acc}
              role={role}
              context={quickActionsContext}
              onAction={onQuickAction}
              compact={layoutMode === "compact"}
              embedded
              isDefault={isDefault}
              setPrimaryPending={setPrimaryPending}
              updatePending={updatePending}
              onSetPrimary={onSetPrimary}
              onEdit={onEdit}
              onArchive={onArchive}
              onClose={onClose}
              onRestore={onRestore}
              onClearLedger={onClearLedger}
              onDelete={onDelete}
            />
          </div>
          {acc.last_activity_date ? (
            <div
              className="shrink-0 text-right"
              data-testid="account-last-activity"
            >
              <div className="text-[10px] uppercase tracking-wide text-gray-400">Last activity</div>
              <div className="text-xs text-gray-600 tabular-nums">
                {formatDateDisplay(acc.last_activity_date)}
              </div>
            </div>
          ) : null}
        </div>
      ) : acc.last_activity_date ? (
        <div
          className={`flex justify-end ${
            layoutMode === "compact" ? "mt-2" : "mt-3 pt-3 border-t border-gray-100"
          }`}
        >
          <div className="text-right" data-testid="account-last-activity">
            <div className="text-[10px] uppercase tracking-wide text-gray-400">Last activity</div>
            <div className="text-xs text-gray-600 tabular-nums">
              {formatDateDisplay(acc.last_activity_date)}
            </div>
          </div>
        </div>
      ) : null}
    </article>
    <AccountBucketsModal
      accountId={acc.id}
      accountName={getEffectiveDisplayName(acc)}
      open={bucketsOpen}
      onClose={() => setBucketsOpen(false)}
    />
    </>
  );
}

function CreditMetricsGrid({
  acc,
  utilAboveTarget,
}: {
  acc: Account;
  utilAboveTarget: boolean;
}) {
  const paymentDueValue =
    acc.next_payment_due_date != null
      ? acc.statement_balance != null
        ? `${formatDateDisplay(acc.next_payment_due_date)} · ${formatCurrency(acc.statement_balance, acc.currency)}`
        : formatDateDisplay(acc.next_payment_due_date)
      : "—";

  return (
    <div
      className="grid grid-cols-[4.25rem_4.25rem_4.5rem_5rem_6.75rem] sm:grid-cols-[4.75rem_4.75rem_5rem_5.5rem_7.25rem] gap-x-3 gap-y-1 items-end"
      data-testid="credit-metrics-grid"
    >
      <MetricBlock
        label="Owed"
        value={
          acc.balance_owed != null ? formatCurrency(acc.balance_owed, acc.currency) : "—"
        }
        valueClass={acc.balance_owed != null ? "text-red-700" : "text-gray-400"}
        testId="credit-balance-owed"
      />
      <MetricBlock
        label="Available"
        value={
          acc.available_credit != null
            ? formatCurrency(acc.available_credit, acc.currency)
            : "—"
        }
        valueClass={acc.available_credit != null ? "text-gray-900" : "text-gray-400"}
        testId="credit-available"
      />
      <MetricBlock
        label="Utilization"
        value={acc.utilization_percent != null ? `${acc.utilization_percent}%` : "—"}
        valueClass={
          acc.utilization_percent != null
            ? utilAboveTarget
              ? "text-amber-700"
              : "text-gray-800"
            : "text-gray-400"
        }
        testId="credit-utilization"
      />
      <MetricBlock
        label="Proj. statement"
        value={
          acc.projected_statement_balance != null
            ? formatCurrency(acc.projected_statement_balance, acc.currency)
            : "—"
        }
        valueClass={acc.projected_statement_balance != null ? "text-gray-900" : "text-gray-400"}
        compactValue
        testId="credit-projected-statement"
      />
      <MetricBlock
        label="Payment due"
        value={paymentDueValue}
        valueClass={
          acc.next_payment_due_date != null
            ? acc.is_payment_due_soon
              ? "text-amber-700"
              : "text-gray-800"
            : "text-gray-400"
        }
        compactValue
        testId="credit-payment-due"
      />
    </div>
  );
}

function MetricBlock({
  label,
  value,
  valueClass = "text-gray-900",
  compactValue = false,
  testId,
}: {
  label: string;
  value: string;
  valueClass?: string;
  compactValue?: boolean;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div
        className={`font-semibold tabular-nums ${compactValue ? "text-xs" : "text-sm"} ${valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}

function LifecycleBadge({
  status,
  closedAt,
}: {
  status: ReturnType<typeof accountLifecycleStatus>;
  closedAt?: string | null;
}) {
  const labels: Record<string, string> = {
    archived: "Archived",
    closed: "Closed",
    deleted: "Deleted",
  };
  const colors: Record<string, string> = {
    archived: "bg-gray-200 text-gray-700",
    closed: "bg-slate-200 text-slate-800",
    deleted: "bg-red-100 text-red-800",
  };
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${colors[status] ?? "bg-gray-100"}`}>
      {labels[status] ?? status}
      {status === "closed" && closedAt ? ` · ${closedAt}` : ""}
    </span>
  );
}

function CreditDetails({ acc }: { acc: Account }) {
  const targetUtil = parseFloat(acc.target_utilization_percent ?? "10");
  const utilAboveTarget =
    acc.utilization_percent != null && parseFloat(acc.utilization_percent) > targetUtil;
  const cycleEnd = acc.billing_cycle_end_date ?? acc.next_statement_date;

  return (
    <div className="mt-1 text-xs text-gray-600 space-y-0.5">
      {cycleEnd ? <div>Billing cycle ends {formatDateDisplay(cycleEnd)}</div> : null}
      {acc.apr != null && acc.apr !== "" ? <div>APR: {acc.apr}%</div> : null}
      {acc.utilization_percent != null ? (
        <div className={utilAboveTarget ? "text-amber-700 font-medium" : ""}>
          Utilization: {acc.utilization_percent}% (target {targetUtil}%)
        </div>
      ) : null}
      {acc.next_payment_due_date && acc.statement_balance != null ? (
        <div>
          Due {formatDateDisplay(acc.next_payment_due_date)}: {formatCurrency(acc.statement_balance, acc.currency)}
        </div>
      ) : null}
      {acc.payoff_estimate?.label ? (
        <div className="text-indigo-700">{acc.payoff_estimate.label}</div>
      ) : null}
    </div>
  );
}

