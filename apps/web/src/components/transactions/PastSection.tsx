import type { RefObject } from "react";
import { formatCurrency } from "@budget-app/shared";
import TransactionRow, { timelineRowToData, transactionToData } from "./TransactionRow";
import type { LedgerRow, ViewMode } from "./transactionsLedgerUtils";

type Props = {
  start: LedgerRow | null;
  past: LedgerRow[];
  viewMode: ViewMode;
  currency: string;
  isCredit: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  expanded: boolean;
  hasFuture: boolean;
  panelFocus: "split" | "past" | "future";
  onExpandFuture: () => void;
  onBalancedLayout: () => void;
  onShowPast: () => void;
  onEditTimeline: (transactionId: number) => void;
  onEditTransaction: (txn: import("@budget-app/shared").Transaction) => void;
  onDuplicateById: (transactionId: number) => void;
  onDuplicate: (txn: import("@budget-app/shared").Transaction) => void;
  onDelete: (transactionId: number, label: string) => void;
  deletePending: boolean;
};

export default function PastSection({
  start,
  past,
  viewMode,
  currency,
  isCredit,
  scrollRef,
  collapsed,
  expanded,
  hasFuture,
  panelFocus,
  onExpandFuture,
  onBalancedLayout,
  onShowPast,
  onEditTimeline,
  onEditTransaction,
  onDuplicateById,
  onDuplicate,
  onDelete,
  deletePending,
}: Props) {
  const fmtBal = (bal: number) => formatCurrency(isCredit ? Math.abs(bal) : bal, currency);
  const creditClass = (bal: number) => (isCredit ? (bal > 0 ? "text-green-600" : "text-red-600") : "");

  if (collapsed) {
    return (
      <section className="flex-none border-b-4 border-gray-300">
        <button
          type="button"
          onClick={onShowPast}
          className="w-full px-4 py-2 bg-gray-100 text-sm font-semibold text-gray-700 flex items-center justify-between hover:bg-gray-200/70"
        >
          Past (hidden)
          <ChevronDown />
        </button>
      </section>
    );
  }

  return (
    <section
      className={`flex flex-col border-b-4 border-gray-300 ${expanded ? "flex-1 min-h-0" : "flex-none"}`}
    >
      <header className="px-4 py-2 bg-gray-100 border-b border-gray-200 flex items-center justify-between gap-2 shrink-0">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Past</h2>
        <div className="flex items-center gap-1">
          {hasFuture && panelFocus === "split" && (
            <IconButton label="Expand future" onClick={onExpandFuture}>
              <ChevronUp />
            </IconButton>
          )}
          {hasFuture && panelFocus === "past" && (
            <IconButton label="Balanced layout" onClick={onBalancedLayout}>
              <ChevronDown />
            </IconButton>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className={expanded ? "flex-1 min-h-0 overflow-auto" : "overflow-auto max-h-64"}
      >
        {start?.type === "starting_balance" && (
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex justify-between text-sm">
            <span className="font-medium text-gray-600">Starting Balance</span>
            <span className={`font-semibold tabular-nums ${creditClass(start.balance)}`}>
              {fmtBal(start.balance)}
            </span>
          </div>
        )}

        {past.map((row) => {
          if (row.type === "transaction_from_timeline") {
            const data = timelineRowToData(row.row, row.balance, "past");
            return (
              <TransactionRow
                key={data.id}
                row={data}
                variant="past"
                viewMode={viewMode}
                currency={currency}
                isCredit={isCredit}
                onEdit={
                  row.row.transaction_id != null
                    ? () => onEditTimeline(row.row.transaction_id!)
                    : undefined
                }
                onDuplicate={
                  row.row.transaction_id != null
                    ? () => onDuplicateById(row.row.transaction_id!)
                    : undefined
                }
                onDelete={
                  row.row.transaction_id != null
                    ? () => onDelete(row.row.transaction_id!, row.row.description)
                    : undefined
                }
                actionsDisabled={deletePending}
              />
            );
          }
          if (row.type === "transaction") {
            const data = transactionToData(row.txn, row.balance);
            return (
              <TransactionRow
                key={data.id}
                row={data}
                variant="past"
                viewMode={viewMode}
                currency={currency}
                isCredit={isCredit}
                onEdit={() => onEditTransaction(row.txn)}
                onDuplicate={() => onDuplicate(row.txn)}
                onDelete={() => onDelete(row.txn.id, row.txn.payee)}
                actionsDisabled={deletePending}
              />
            );
          }
          return null;
        })}
      </div>
    </section>
  );
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-1 rounded-md hover:bg-gray-200/80 border border-transparent hover:border-gray-300"
    >
      {children}
    </button>
  );
}

function ChevronUp() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}
