import { ChevronRight } from "lucide-react";
import { formatCurrency } from "@budget-app/shared";
import {
  computeGroupSummary,
  isDebtAccount,
  type AccountGroup,
} from "../../lib/accountOrganization";
import AccountListItem from "./AccountListItem";
import type { Account, AccountRole } from "@budget-app/shared";
import type { AccountLayoutMode } from "../../lib/accountOrganization";
import type { ForecastDays } from "../../lib/safeToSpendLabels";
import type { QuickActionDef, QuickActionsContext } from "../../lib/accountQuickActions";

type Props = {
  group: AccountGroup;
  collapsed: boolean;
  showSummary: boolean;
  layoutMode: AccountLayoutMode;
  forecastDays: ForecastDays;
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
};

export default function AccountGroupSection({
  group,
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
}: Props) {
  const summary = computeGroupSummary(group.accounts);
  const isCreditGroup = group.accounts.some((a) => a.account_type === "CREDIT");
  const isCashGroup = group.accounts.some(
    (a) => a.account_type !== "CREDIT" && !isDebtAccount(a)
  );

  return (
    <section className="border-b border-gray-200 last:border-b-0">
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
        {showSummary && !collapsed ? (
          <GroupSummaryLine summary={summary} isCreditGroup={isCreditGroup} isCashGroup={isCashGroup} />
        ) : showSummary && collapsed ? (
          <CollapsedSummaryHint summary={summary} isCreditGroup={isCreditGroup} />
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
  summary,
  isCreditGroup,
  isCashGroup,
}: {
  summary: ReturnType<typeof computeGroupSummary>;
  isCreditGroup: boolean;
  isCashGroup: boolean;
}) {
  const parts: string[] = [];

  if (isCreditGroup && summary.totalDebt > 0) {
    parts.push(`Balance owed: ${formatCurrency(String(summary.totalDebt.toFixed(2)), summary.currency)}`);
    if (summary.avgUtilization != null) {
      parts.push(`Avg utilization: ${summary.avgUtilization.toFixed(0)}%`);
    }
  } else if (isCashGroup && summary.totalSafeToSpend > 0) {
    parts.push(`Safe to spend: ${formatCurrency(String(summary.totalSafeToSpend.toFixed(2)), summary.currency)}`);
    if (summary.lowestProjected != null) {
      parts.push(
        `Lowest projected: ${formatCurrency(String(summary.lowestProjected.toFixed(2)), summary.currency)}`
      );
    }
  } else if (summary.totalBalance !== 0) {
    parts.push(`Total: ${formatCurrency(String(summary.totalBalance.toFixed(2)), summary.currency)}`);
  }

  if (summary.riskCount > 0) {
    parts.push(
      `${summary.riskCount} account${summary.riskCount === 1 ? "" : "s"} at risk`
    );
  }

  if (parts.length === 0) return null;

  return (
    <span className="text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-0.5 ml-auto">
      {parts.map((p) => (
        <span key={p}>{p}</span>
      ))}
    </span>
  );
}

function CollapsedSummaryHint({
  summary,
  isCreditGroup,
}: {
  summary: ReturnType<typeof computeGroupSummary>;
  isCreditGroup: boolean;
}) {
  const hint =
    isCreditGroup && summary.totalDebt > 0
      ? formatCurrency(String(summary.totalDebt.toFixed(2)), summary.currency)
      : summary.totalSafeToSpend > 0
        ? formatCurrency(String(summary.totalSafeToSpend.toFixed(2)), summary.currency)
        : null;
  if (!hint) return null;
  return <span className="text-xs text-gray-500 ml-auto">{hint}</span>;
}
