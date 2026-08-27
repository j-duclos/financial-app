import { formatCurrency } from "@budget-app/shared";
import type { TimelineRow, Transaction } from "@budget-app/shared";
import TransactionContextMenu from "./TransactionContextMenu";
import TransactionStatusIcons from "./TransactionStatusIcons";
import { categoryLabel, creditBalanceColorClass, formatDateDisplay } from "./transactionsLedgerUtils";
import { LEDGER_TABLE_GRID } from "./ledgerTableLayout";
import { resolveTransactionKind } from "./transactionKindUtils";
import type { ForecastRowSeverityClasses } from "./forecastRowSeverity";

export type TransactionRowData = {
  id: string;
  date: string;
  payee: string;
  category: string;
  amount: number;
  /** Null = sealed/reconciled history; display as — */
  balance: number | null;
  isOutflow: boolean;
  source: { source?: string; rule_id?: number | null; type?: string; direction?: string; category_name?: string | null; description?: string };
  reconciled?: boolean;
  txnSource?: string | null;
  importMatchStatus?: string | null;
  plaidTransactionId?: string | null;
  transactionId?: number | null;
  accountId?: number | null;
  linkedTransactionId?: number | null;
  hasTransferDestination?: boolean;
  readOnly?: boolean;
};

/** Stable key for a projection-only rule row (no transaction id yet). */
export function projectionSelectionKey(row: TransactionRowData): string | null {
  if (row.source.rule_id == null || row.accountId == null || !row.date) return null;
  return `rule:${row.source.rule_id}:${row.accountId}:${row.date}`;
}

/** Rows that can be batch-deleted: real txns, or scheduled rule rows that can be materialized. */
export function canSelectTransactionForBatchDelete(row: TransactionRowData): boolean {
  if (row.reconciled || row.readOnly) return false;
  if ((row.plaidTransactionId ?? "").trim()) return false;
  if ((row.txnSource ?? "").toUpperCase() === "PLAID") return false;
  if (row.transactionId != null) return true;
  return row.source.rule_id != null && row.accountId != null;
}

type Props = {
  row: TransactionRowData;
  variant: "past" | "future" | "expected";
  currency: string;
  isCredit: boolean;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSkip?: () => void;
  onMatchesImported?: () => void;
  onMoveDate?: () => void;
  actionsDisabled?: boolean;
  /** Multi-select for batch delete. */
  selected?: boolean;
  onSelectedChange?: (transactionId: number, selected: boolean, shiftKey?: boolean) => void;
  /** Select a projection-only rule row (no transaction id yet). */
  onSelectUnresolved?: (row: TransactionRowData, selected: boolean, shiftKey?: boolean) => void;
  /** Row background / border styling (forecast buffer/risk or schedule highlight). */
  rowSurface?: ForecastRowSeverityClasses;
  /** Tooltip when a scheduled row is highlighted as unmatched vs later imports. */
  scheduleHighlightTitle?: string;
};

export function timelineRowToData(
  row: TimelineRow,
  balance: number | null,
  keyPrefix: string
): TransactionRowData {
  const amt = parseFloat(row.amount);
  return {
    id: `${keyPrefix}-${row.transaction_id ?? row.date}-${row.description}`,
    date: row.date,
    payee: row.description,
    category: categoryLabel(row.category_name, row.description),
    amount: amt,
    balance,
    isOutflow: row.type === "OUTFLOW" || row.type === "EXPENSE",
    source: {
      source: row.source,
      rule_id: row.rule_id,
      type: row.type,
      category_name: row.category_name,
      description: row.description,
    },
    reconciled: row.reconciled ?? false,
    txnSource: row.txn_source ?? null,
    importMatchStatus: row.import_match_status ?? null,
    plaidTransactionId: row.plaid_transaction_id ?? null,
    transactionId: row.transaction_id,
    accountId: row.account_id ?? null,
    readOnly: row.source === "interest",
    linkedTransactionId: null,
    hasTransferDestination: false,
  };
}

export function transactionToData(txn: Transaction, balance: number | null): TransactionRowData {
  const amt = parseFloat(txn.amount);
  return {
    id: `txn-${txn.id}`,
    date: txn.date,
    payee: txn.payee,
    category: categoryLabel(txn.category?.name, txn.payee),
    amount: amt,
    balance,
    isOutflow: txn.direction === "OUTFLOW",
    source: {
      source: txn.source,
      rule_id: txn.rule_id,
      direction: txn.direction,
      category_name: txn.category?.name,
      description: txn.payee,
    },
    reconciled: txn.reconciled ?? false,
    txnSource: txn.source ?? null,
    importMatchStatus: txn.import_match_status ?? null,
    plaidTransactionId: txn.plaid_transaction_id ?? null,
    transactionId: txn.id,
    accountId: txn.account_id ?? (txn.account as { id?: number } | undefined)?.id ?? null,
    linkedTransactionId: txn.linked_transaction_id ?? null,
    hasTransferDestination: Boolean(txn.transfer_to_account),
  };
}

export default function TransactionRow({
  row,
  variant,
  currency,
  isCredit,
  onEdit,
  onDuplicate,
  onDelete,
  onSkip,
  onMatchesImported,
  onMoveDate,
  actionsDisabled,
  selected = false,
  onSelectedChange,
  onSelectUnresolved,
  rowSurface,
  scheduleHighlightTitle,
}: Props) {
  const fmtBal = (bal: number) => formatCurrency(bal, currency);
  const creditClass =
    row.balance == null ? "text-gray-400" : creditBalanceColorClass(isCredit, row.balance);
  const abs = Math.abs(row.amount);
  const amountStr = row.isOutflow ? `- ${formatCurrency(abs, currency)}` : formatCurrency(abs, currency);
  const clickable = Boolean(onEdit) && !row.readOnly;
  const selectable =
    canSelectTransactionForBatchDelete(row) &&
    (onSelectedChange != null || onSelectUnresolved != null);
  const kind = resolveTransactionKind({
    type: row.source.type,
    direction: row.source.direction,
    category_name: row.source.category_name,
    description: row.source.description,
    linked_transaction_id: row.linkedTransactionId,
    has_transfer_destination: row.hasTransferDestination,
  });

  const surfaceClasses = rowSurface
    ? `${rowSurface.backgroundClass} ${rowSurface.hoverClass} ${rowSurface.borderClass}`
    : "bg-white hover:bg-gray-50/80 border-b border-gray-100";
  const selectedSurface = selected ? "bg-blue-50/70" : "";

  return (
    <article
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={scheduleHighlightTitle}
      onClick={() => {
        if (clickable) onEdit?.();
      }}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onEdit?.();
        }
      }}
      className={`group ${LEDGER_TABLE_GRID} px-4 py-2 text-sm ${surfaceClasses} ${selectedSurface} ${clickable ? "cursor-pointer" : ""}`}
    >
      <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
        {selectable ? (
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => {
              if (!e.shiftKey) return;
              // Own the toggle: select the range including this row.
              e.preventDefault();
              if (row.transactionId != null && onSelectedChange) {
                onSelectedChange(row.transactionId, true, true);
              } else if (onSelectUnresolved) {
                onSelectUnresolved(row, true, true);
              }
            }}
            onChange={(e) => {
              const checked = e.target.checked;
              if (row.transactionId != null && onSelectedChange) {
                onSelectedChange(row.transactionId, checked, false);
              } else if (onSelectUnresolved) {
                onSelectUnresolved(row, checked, false);
              }
            }}
            disabled={actionsDisabled}
            aria-label={`Select ${row.payee}`}
            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
          />
        ) : (
          <span aria-hidden className="h-3.5 w-3.5" />
        )}
      </span>
      <time className="text-xs text-gray-500 tabular-nums">{formatDateDisplay(row.date)}</time>
      <div className="flex justify-center">
        <TransactionStatusIcons
          reconciled={row.reconciled}
          txnSource={row.txnSource}
          importMatchStatus={row.importMatchStatus}
          plaidTransactionId={row.plaidTransactionId}
          ledgerSource={row.source.source}
          ruleId={row.source.rule_id}
          transactionId={row.transactionId}
          readOnly={row.readOnly}
          type={row.source.type}
          category_name={row.source.category_name}
          description={row.source.description}
          linkedTransactionId={row.linkedTransactionId}
          hasTransferDestination={row.hasTransferDestination}
        />
      </div>
      <p className="min-w-0 truncate font-medium text-gray-900" title={row.payee}>
        {row.payee}
      </p>
      <span className="min-w-0 truncate text-[10px] font-medium text-gray-600">{kind}</span>
      <p className="min-w-0 truncate text-xs text-gray-500">{row.category}</p>
      <span
        className={`text-right font-medium tabular-nums ${row.isOutflow ? "text-red-600" : "text-green-600"}`}
      >
        {amountStr}
      </span>
      <span className={`text-right font-medium tabular-nums text-xs ${creditClass}`}>
        {row.balance == null ? "—" : fmtBal(row.balance)}
      </span>
      <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
        <TransactionContextMenu
          variant={variant}
          onEdit={onEdit}
          onDuplicate={variant === "past" ? onDuplicate : undefined}
          onDelete={onDelete}
          onSkip={variant === "future" || variant === "expected" ? onSkip : undefined}
          onMatchesImported={variant === "expected" ? onMatchesImported : undefined}
          onMoveDate={variant === "expected" ? onMoveDate : undefined}
          disabled={actionsDisabled}
          readOnly={row.readOnly}
        />
      </div>
    </article>
  );
}
