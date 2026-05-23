import { formatCurrency } from "@budget-app/shared";
import type { TimelineRow, Transaction } from "@budget-app/shared";
import TransactionSourceBadge from "./TransactionSourceBadge";
import TransactionContextMenu from "./TransactionContextMenu";
import { categoryLabel, formatDateDisplay, type ViewMode } from "./transactionsLedgerUtils";

export type TransactionRowData = {
  id: string;
  date: string;
  payee: string;
  category: string;
  amount: number;
  balance: number;
  isOutflow: boolean;
  source: { source?: string; rule_id?: number | null; type?: string; direction?: string; category_name?: string | null; description?: string };
  transactionId?: number | null;
  readOnly?: boolean;
};

type Props = {
  row: TransactionRowData;
  variant: "past" | "future";
  viewMode: ViewMode;
  currency: string;
  isCredit: boolean;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSkip?: () => void;
  onMove?: () => void;
  actionsDisabled?: boolean;
};

export function timelineRowToData(
  row: TimelineRow,
  balance: number,
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
    transactionId: row.transaction_id,
    readOnly: row.source === "interest",
  };
}

export function transactionToData(txn: Transaction, balance: number): TransactionRowData {
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
    },
    transactionId: txn.id,
  };
}

export default function TransactionRow({
  row,
  variant,
  viewMode,
  currency,
  isCredit,
  onEdit,
  onDuplicate,
  onDelete,
  onSkip,
  onMove,
  actionsDisabled,
}: Props) {
  const fmtBal = (bal: number) => formatCurrency(isCredit ? Math.abs(bal) : bal, currency);
  const creditClass = isCredit ? (row.balance > 0 ? "text-green-600" : "text-red-600") : "";
  const abs = Math.abs(row.amount);
  const amountStr = row.isOutflow ? `- ${formatCurrency(abs, currency)}` : formatCurrency(abs, currency);

  const balanceFirst = viewMode === "balance";

  return (
    <article
      className={`group flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 hover:bg-gray-50/80 ${
        variant === "future" ? "bg-amber-50/30" : "bg-white"
      }`}
    >
      {balanceFirst ? (
        <>
          <div className={`shrink-0 w-24 text-right font-semibold tabular-nums ${creditClass}`}>
            {fmtBal(row.balance)}
          </div>
          <RowDetails row={row} amountStr={amountStr} />
        </>
      ) : (
        <>
          <RowDetails row={row} amountStr={amountStr} />
          <div className={`shrink-0 w-24 text-right font-medium tabular-nums text-sm ${creditClass}`}>
            {fmtBal(row.balance)}
          </div>
        </>
      )}

      <TransactionContextMenu
        variant={variant}
        onEdit={onEdit}
        onDuplicate={variant === "past" ? onDuplicate : undefined}
        onDelete={onDelete}
        onSkip={variant === "future" ? onSkip : undefined}
        onMove={variant === "future" ? onMove : undefined}
        disabled={actionsDisabled}
        readOnly={row.readOnly}
      />
    </article>
  );
}

function RowDetails({ row, amountStr }: { row: TransactionRowData; amountStr: string }) {
  return (
    <div className="flex-1 min-w-0 grid grid-cols-[5.5rem_1fr_auto] sm:grid-cols-[5.5rem_1fr_8rem_auto] gap-2 items-center">
      <time className="text-xs text-gray-500 tabular-nums">{formatDateDisplay(row.date)}</time>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{row.payee}</p>
        <p className="text-xs text-gray-500 truncate">{row.category}</p>
      </div>
      <TransactionSourceBadge {...row.source} className="hidden sm:inline-flex" />
      <span className={`text-sm font-medium tabular-nums text-right ${row.isOutflow ? "text-red-600" : "text-green-600"}`}>
        {amountStr}
      </span>
    </div>
  );
}

