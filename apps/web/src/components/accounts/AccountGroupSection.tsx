import { ChevronRight } from "lucide-react";
import {
  computeGroupSummary,
  isAtRisk,
  type AccountGroup,
  type AccountGroupBy,
} from "../../lib/accountOrganization";
import { buildAccountForecastAlerts } from "../../lib/accountForecastAlerts";
import { formatGroupSummaryParts } from "../../lib/accountGroupSummaryDisplay";
import AccountListItem from "./AccountListItem";
import type { Account, AccountRole } from "@budget-app/shared";
import type { AccountLayoutMode } from "../../lib/accountOrganization";
import type { PassiveForecastDays } from "../../lib/safeToSpendLabels";
import type { QuickActionDef, QuickActionsContext } from "../../lib/accountQuickActions";

type Props = {
  group: AccountGroup;
  groupBy: AccountGroupBy;
  collapsed: boolean;
  showSummary: boolean;
  layoutMode: AccountLayoutMode;
  forecastDays: PassiveForecastDays;
  defaultAccountId?: number | null;
  allowManualOrder: boolean;
  reorderPending: boolean;
  onToggleCollapse: () => void;
  onMoveAccount: (indexInGroup: number, direction: "up" | "down") => void;
  onSetPrimary: (id: number) => void;
  onEdit: (acc: Account) => void;
  onClearLedger: (acc: Account) => void;
  onDelete: (acc: Account) => void;
  onArchive: (acc: Account) => void;
  onClose: (acc: Account) => void;
  onRestore: (acc: Account) => void;
  onToggleForecast: (id: number, included: boolean) => void;
  onToggleActive: (id: number, active: boolean) => void;
  accountRoleFromApi: (acc: Account) => AccountRole;
  setPrimaryPending: boolean;
  updatePending: boolean;
  quickActionsContext?: QuickActionsContext;
  onQuickAction?: (account: Account, action: QuickActionDef) => void;
  onResolveRisk?: (account: Account) => void;
  highlightedAccountId?: number | null;
  onFocusAccount?: (accountId: number) => void;
};

export default function AccountGroupSection({
  group,
  groupBy,
  collapsed,
  showSummary,
  layoutMode,
  forecastDays,
  defaultAccountId,
  allowManualOrder,
  reorderPending,
  onToggleCollapse,
  onMoveAccount,
  onSetPrimary,
  onEdit,
  onClearLedger,
  onDelete,
  onArchive,
  onClose,
  onRestore,
  onToggleForecast,
  onToggleActive,
  accountRoleFromApi,
  setPrimaryPending,
  updatePending,
  quickActionsContext,
  onQuickAction,
  onResolveRisk,
  highlightedAccountId,
  onFocusAccount,
}: Props) {
  const summary = computeGroupSummary(group.accounts);
  const summaryParts = formatGroupSummaryParts(group.key, groupBy, summary);
  const firstAttentionAccountId =
    group.accounts.find((a) => buildAccountForecastAlerts([a], forecastDays).length > 0)?.id ??
    group.accounts.find((a) => isAtRisk(a))?.id;

  return (
    <section
      className="border-b border-gray-200 last:border-b-0"
      data-testid={`account-group-${group.key}`}
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        className="sticky top-0 z-10 w-full flex flex-wrap items-center gap-x-3 gap-y-1 bg-gray-50 px-4 py-3 text-left hover:bg-gray-100 transition-colors border-b border-gray-100"
        aria-expanded={!collapsed}
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform duration-200 ${
            collapsed ? "" : "rotate-90"
          }`}
          aria-hidden
        />
        <span className="font-semibold text-gray-900">
          {group.label}
          <span className="font-normal text-gray-500 ml-1.5">({summary.count})</span>
        </span>
        {showSummary && summaryParts.length > 0 ? (
          <GroupSummaryLine
            parts={summaryParts}
            riskCount={summary.riskCount}
            onJumpToRisk={
              summary.riskCount > 0 && firstAttentionAccountId != null && onFocusAccount
                ? () => onFocusAccount(firstAttentionAccountId)
                : undefined
            }
          />
        ) : null}
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <ul className="divide-y divide-gray-100">
            {group.accounts.map((acc, index) => (
              <li key={acc.id}>
                <AccountListItem
                  account={acc}
                  role={accountRoleFromApi(acc)}
                  layoutMode={layoutMode}
                  forecastDays={forecastDays}
                  isDefault={defaultAccountId === acc.id}
                  showReorder={allowManualOrder}
                  canMoveUp={index > 0}
                  canMoveDown={index < group.accounts.length - 1}
                  reorderPending={reorderPending}
                  onMoveUp={() => onMoveAccount(index, "up")}
                  onMoveDown={() => onMoveAccount(index, "down")}
                  onSetPrimary={() => onSetPrimary(acc.id)}
                  onEdit={() => onEdit(acc)}
                  onClearLedger={() => onClearLedger(acc)}
                  onDelete={() => onDelete(acc)}
                  onArchive={() => onArchive(acc)}
                  onClose={() => onClose(acc)}
                  onRestore={() => onRestore(acc)}
                  onToggleForecast={(included) => onToggleForecast(acc.id, included)}
                  onToggleActive={(active) => onToggleActive(acc.id, active)}
                  setPrimaryPending={setPrimaryPending}
                  updatePending={updatePending}
                  quickActionsContext={quickActionsContext}
                  onQuickAction={onQuickAction}
                  onResolveRisk={onResolveRisk}
                  isHighlighted={highlightedAccountId === acc.id}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function GroupSummaryLine({
  parts,
  riskCount,
  onJumpToRisk,
}: {
  parts: string[];
  riskCount: number;
  onJumpToRisk?: () => void;
}) {
  if (parts.length === 0) return null;

  return (
    <span
      className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-0.5 ml-auto"
      data-testid="group-summary-line"
    >
      {parts.map((p) => {
        const isRiskPart = riskCount > 0 && p.includes("at risk");
        if (isRiskPart && onJumpToRisk) {
          return (
            <span
              key={p}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onJumpToRisk();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onJumpToRisk();
                }
              }}
              className="text-blue-700 hover:underline font-medium cursor-pointer"
            >
              {p}
            </span>
          );
        }
        return <span key={p}>{p}</span>;
      })}
    </span>
  );
}
