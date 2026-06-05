import type { Account, AccountRole } from "@budget-app/shared";
import {
  accountLifecycleStatus,
} from "../../lib/accountOrganization";
import {
  buildAccountManagementActions,
  buildAccountQuickActions,
  type QuickActionDef,
  type QuickActionsContext,
} from "../../lib/accountQuickActions";
import QuickActionButton from "./QuickActionButton";
import QuickActionMenu from "./QuickActionMenu";

type Props = {
  account: Account;
  role: AccountRole;
  context: QuickActionsContext;
  onAction: (account: Account, action: QuickActionDef) => void;
  compact?: boolean;
  /** When true, parent supplies the card footer border/spacing. */
  embedded?: boolean;
  disabled?: boolean;
  isDefault?: boolean;
  setPrimaryPending?: boolean;
  updatePending?: boolean;
  onSetPrimary?: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
  onClose?: () => void;
  onRestore?: () => void;
  onClearLedger?: () => void;
  onDelete?: () => void;
};

export default function AccountQuickActions({
  account,
  role,
  context,
  onAction,
  compact = false,
  embedded = false,
  disabled,
  isDefault = false,
  setPrimaryPending,
  updatePending,
  onSetPrimary,
  onEdit,
  onArchive,
  onClose,
  onRestore,
  onClearLedger,
  onDelete,
}: Props) {
  const { primary, secondary } = buildAccountQuickActions(account, role, context);
  const lifecycle = accountLifecycleStatus(account);
  const { secondary: mgmtSecondary, danger: mgmtDanger } = buildAccountManagementActions({
    isDefault,
    lifecycle,
    setPrimaryPending,
    updatePending,
  });

  const overflowActions = [...secondary, ...mgmtSecondary];
  const hasOverflow = overflowActions.length > 0 || mgmtDanger.length > 0;

  if (primary.length === 0 && !hasOverflow) return null;

  const handle = (action: QuickActionDef) => {
    switch (action.id) {
      case "mgmt_set_default":
        onSetPrimary?.();
        return;
      case "mgmt_edit":
        onEdit?.();
        return;
      case "mgmt_archive":
        onArchive?.();
        return;
      case "mgmt_close":
        onClose?.();
        return;
      case "mgmt_restore":
        onRestore?.();
        return;
      case "mgmt_clear_ledger":
        onClearLedger?.();
        return;
      case "mgmt_delete":
        onDelete?.();
        return;
      default:
        onAction(account, action);
    }
  };

  const mobileOverflow = [...primary.slice(2), ...overflowActions];
  const desktopOverflow = overflowActions;

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${
        embedded || compact ? "" : "mt-3 pt-3 border-t border-gray-100"
      }`}
      data-testid={`account-quick-actions-${account.id}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="sr-only">Quick actions for {account.name}</span>

      {primary.slice(0, 2).map((action) => (
        <QuickActionButton
          key={`${action.id}-${action.label}`}
          label={action.label}
          icon={action.icon}
          disabled={disabled || action.disabled}
          tooltip={action.tooltip}
          badge={action.badge}
          showLabel={!compact}
          onClick={() => handle(action)}
        />
      ))}

      {primary.slice(2).map((action) => (
        <QuickActionButton
          key={`${action.id}-${action.label}-desktop`}
          label={action.label}
          icon={action.icon}
          disabled={disabled || action.disabled}
          tooltip={action.tooltip}
          badge={action.badge}
          showLabel={!compact}
          className="hidden sm:inline-flex"
          onClick={() => handle(action)}
        />
      ))}

      {hasOverflow ? (
        <>
          <div className="sm:hidden">
            <QuickActionMenu
              actions={mobileOverflow}
              dangerActions={mgmtDanger}
              onAction={handle}
              disabled={disabled}
            />
          </div>
          <div className="hidden sm:block">
            <QuickActionMenu
              actions={desktopOverflow}
              dangerActions={mgmtDanger}
              onAction={handle}
              disabled={disabled}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
