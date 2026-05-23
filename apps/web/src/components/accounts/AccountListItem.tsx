import { formatCurrency, getAccountInstitutionSubtitle, getEffectiveDisplayName } from "@budget-app/shared";
import type { Account, AccountRole } from "@budget-app/shared";
import AccountHealthBadge from "../AccountHealthBadge";
import { AccountRoleBadge } from "../AccountRoleBadge";
import {
  safeToSpendLabel,
  showSafeToSpendForRole,
  type ForecastDays,
} from "../../lib/safeToSpendLabels";
import {
  accountLifecycleStatus,
  type AccountLayoutMode,
} from "../../lib/accountOrganization";
import AccountQuickActions from "../quickActions/AccountQuickActions";
import type { QuickActionDef, QuickActionsContext } from "../../lib/accountQuickActions";

type Props = {
  account: Account;
  role: AccountRole;
  layoutMode: AccountLayoutMode;
  forecastDays: ForecastDays;
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
}: Props) {
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

  const showProjection =
    layoutMode !== "compact" && acc.lowest_projected_balance_30_days != null;

  return (
    <article
      className={`${padding} hover:bg-gray-50/80 transition-colors ${isMuted ? "opacity-75 bg-gray-50/50" : ""}`}
      data-testid={`account-row-${acc.id}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
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

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium text-gray-900 truncate">{getEffectiveDisplayName(acc)}</h3>
            {layoutMode !== "compact" ? (
              <AccountRoleBadge role={role} compact />
            ) : null}
            {lifecycle !== "active" ? (
              <LifecycleBadge status={lifecycle} closedAt={acc.closed_at} />
            ) : null}
            {isDefault ? (
              <span className="text-xs text-amber-600 font-medium">Default</span>
            ) : null}
          </div>

          {healthStatus ? (
            <AccountHealthBadge
              status={healthStatus}
              reason={healthReason}
              account={acc}
              compact={layoutMode === "compact"}
              inline
            />
          ) : null}

          {layoutMode !== "compact" ? (
            <p className="text-xs text-gray-500 truncate">{getAccountInstitutionSubtitle(acc)}</p>
          ) : null}

          {layoutMode !== "compact" && acc.purpose?.trim() ? (
            <p className="text-xs text-gray-600">{acc.purpose.trim()}</p>
          ) : null}

          {layoutMode === "detailed" && isCredit ? (
            <CreditDetails acc={acc} />
          ) : layoutMode === "comfortable" && isCredit && acc.utilization_percent != null ? (
            <p
              className={`text-xs ${
                Number(acc.utilization_percent) >= 30 ? "text-amber-700" : "text-gray-500"
              }`}
            >
              {acc.utilization_percent}% utilized
              {acc.is_payment_due_soon ? " · Due soon" : ""}
            </p>
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

        <div className="flex flex-wrap sm:flex-col items-end gap-3 sm:gap-2 shrink-0 sm:ml-auto sm:text-right">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">{primaryLabel}</div>
            <div
              className={`font-semibold tabular-nums ${
                isCredit && acc.balance_owed != null ? "text-red-700" : "text-gray-900"
              } ${layoutMode === "compact" ? "text-sm" : "text-base"}`}
            >
              {primaryBalance}
            </div>
          </div>

          {showSafe && acc.available_to_spend != null && layoutMode !== "compact" ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">
                {safeToSpendLabel(role)}
              </div>
              <div
                className={`font-semibold tabular-nums text-sm ${
                  parseFloat(acc.available_to_spend) < 0 ? "text-red-700" : "text-emerald-800"
                }`}
              >
                {formatCurrency(acc.available_to_spend, acc.currency)}
              </div>
            </div>
          ) : null}

          {showProjection ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-400">
                Low {forecastDays}d
              </div>
              <div
                className={`font-semibold tabular-nums text-sm ${
                  parseFloat(acc.lowest_projected_balance_30_days!) < 0
                    ? "text-red-700"
                    : "text-gray-800"
                }`}
              >
                {formatCurrency(acc.lowest_projected_balance_30_days!, acc.currency)}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {quickActionsContext && onQuickAction ? (
        <AccountQuickActions
          account={acc}
          role={role}
          context={quickActionsContext}
          onAction={onQuickAction}
          compact={layoutMode === "compact"}
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
      ) : null}
    </article>
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
  return (
    <div className="mt-1 text-xs text-gray-600 space-y-0.5">
      {acc.apr != null && acc.apr !== "" ? <div>APR: {acc.apr}%</div> : null}
      {acc.utilization_percent != null ? (
        <div className={Number(acc.utilization_percent) >= 30 ? "text-amber-700 font-medium" : ""}>
          Utilization: {acc.utilization_percent}%
        </div>
      ) : null}
      {acc.next_payment_due_date && acc.statement_balance != null ? (
        <div>
          Due {acc.next_payment_due_date}: {formatCurrency(acc.statement_balance, acc.currency)}
        </div>
      ) : null}
    </div>
  );
}
