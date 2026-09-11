import { formatCurrency, isImportMatchStatusMatched } from "@budget-app/shared";
import type { TimelineRow, Transaction } from "@budget-app/shared";
import TransactionContextMenu from "./TransactionContextMenu";
import TransactionStatusIcons from "./TransactionStatusIcons";
import { categoryLabel, creditBalanceColorClass, formatDateDisplay, isPlannedScheduledTimelineRow, isPlannedScheduledTransaction } from "./transactionsLedgerUtils";
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
  /** Rule/one-time forecast occurrence — lifecycle action is Skip, not Delete. */
  plannedScheduled?: boolean;
};

/** Posted ledger rows the user can check off while reviewing a statement (imports included). */
export function canSelectTransactionForReview(row: TransactionRowData): boolean {
  return row.transactionId != null;
}

/** Rows that can be batch-deleted: posted manual txns only (not planned forecast occurrences). */
export function canSelectTransactionForBatchDelete(row: TransactionRowData): boolean {
  if (row.reconciled || row.readOnly) return false;
  if (row.plannedScheduled) return false;
  if ((row.plaidTransactionId ?? "").trim()) return false;
  if ((row.txnSource ?? "").toUpperCase() === "PLAID") return false;
  return row.transactionId != null;
}

/** Count and signed amount of selected posted rows (for statement tallying). */
export function reviewSelectionTotals(
  selectedIds: ReadonlySet<number>,
  rows: readonly Pick<TransactionRowData, "transactionId" | "amount">[]
): { count: number; sum: number } {
  const seen = new Set<number>();
  let sum = 0;
  for (const row of rows) {
    const id = row.transactionId;
    if (id == null || !selectedIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const amt = Number(row.amount);
    if (Number.isFinite(amt)) sum += amt;
  }
  return { count: seen.size, sum };
}

/** Drop selected IDs that are no longer represented in the visible ledger. */
export function pruneSelectedTransactionIds(
  selectedIds: ReadonlySet<number>,
  visibleIds: Iterable<number | null | undefined>
): Set<number> {
  const visible = new Set<number>();
  for (const id of visibleIds) {
    if (id != null) visible.add(id);
  }
  const next = new Set<number>();
  for (const id of selectedIds) {
    if (visible.has(id)) next.add(id);
  }
  return next;
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
  onMatchImport?: () => void;
  onMoveDate?: () => void;
  actionsDisabled?: boolean;
  /** Multi-select for statement review (and batch delete when allowed). */
  selected?: boolean;
  onSelectedChange?: (transactionId: number, selected: boolean, shiftKey?: boolean) => void;
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
    isOutflow: Number.isFinite(amt) && amt !== 0
      ? amt < 0
      : row.type === "OUTFLOW" || row.type === "EXPENSE",
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
    plannedScheduled: isPlannedScheduledTimelineRow(row),
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
    plannedScheduled: isPlannedScheduledTransaction(txn),
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
  onMatchImport,
  onMoveDate,
  actionsDisabled,
  selected = false,
  onSelectedChange,
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
    canSelectTransactionForReview(row) && row.transactionId != null && onSelectedChange != null;
  const kind = resolveTransactionKind({
    type: row.source.type,
    direction: row.source.direction,
    category_name: row.source.category_name,
    description: row.source.description,
    linked_transaction_id: row.linkedTransactionId,
    has_transfer_destination: row.hasTransferDestination,
  });

  const surfaceClasses = selected
    ? "bg-blue-100 hover:bg-blue-100 border-b border-blue-200"
    : rowSurface
      ? `${rowSurface.backgroundClass} ${rowSurface.hoverClass} ${rowSurface.borderClass}`
      : "bg-white hover:bg-gray-50/80 border-b border-gray-100";

  return (
    <article
      role={clickable || selectable ? "button" : undefined}
      tabIndex={clickable || selectable ? 0 : undefined}
      title={scheduleHighlightTitle}
      onClick={(e) => {
        if (selectable && row.transactionId != null && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSelectedChange?.(row.transactionId, e.shiftKey ? true : !selected, e.shiftKey);
          return;
        }
        if (clickable) onEdit?.();
      }}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onEdit?.();
        }
      }}
      className={`group ${LEDGER_TABLE_GRID} px-4 py-2 text-sm ${surfaceClasses} ${clickable || selectable ? "cursor-pointer" : ""}`}
    >
      <span className="flex justify-center" onClick={(e) => e.stopPropagation()}>
        {selectable ? (
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => {
              if (!e.shiftKey || row.transactionId == null || !onSelectedChange) return;
              e.preventDefault();
              onSelectedChange(row.transactionId, true, true);
            }}
            onChange={(e) => {
              if (row.transactionId == null || !onSelectedChange) return;
              onSelectedChange(row.transactionId, e.target.checked, false);
            }}
            disabled={actionsDisabled}
            aria-label={`Mark ${row.payee} for review`}
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
      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {variant === "expected" && isImportMatchStatusMatched(row.importMatchStatus) ? (
          <span className="rounded border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800 whitespace-nowrap">
            Matched to bank import
          </span>
        ) : null}
        <TransactionContextMenu
          variant={variant}
          onEdit={onEdit}
          onDuplicate={variant === "past" ? onDuplicate : undefined}
          onDelete={onDelete}
          onSkip={variant === "future" || variant === "expected" ? onSkip : undefined}
          onMoveDate={variant === "expected" ? onMoveDate : undefined}
          onMatchImport={variant === "expected" ? onMatchImport : undefined}
          disabled={actionsDisabled}
          readOnly={row.readOnly}
        />
      </div>
    </article>
  );
}
