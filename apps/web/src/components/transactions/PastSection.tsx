import { useRef, useEffect } from "react";
import { formatCurrency } from "@budget-app/shared";
import TransactionRow, { timelineRowToData, transactionToData } from "./TransactionRow";
import {
  COLLAPSED_LEDGER_ROWS,
  LEDGER_TABLE_GRID,
  LedgerColumnHeader,
  LedgerSectionHeader,
} from "./ledgerTableLayout";
import { creditBalanceColorClass, canEditLedgerTimelineRow, shouldHighlightUnmatchedScheduledRow, type LedgerRow } from "./transactionsLedgerUtils";
import { unmatchedScheduleRowClasses, UNMATCHED_SCHEDULE_ROW_TITLE } from "./forecastRowSeverity";
import type { TimelineRow } from "@budget-app/shared";

export const PAST_SCROLL_MIN_ROWS = COLLAPSED_LEDGER_ROWS;

const ROW_REM = 2.5;
const compactScrollHeight = `${COLLAPSED_LEDGER_ROWS * ROW_REM}rem`;

type Props = {
  start: LedgerRow | null;
  past: LedgerRow[];
  /** Full account timeline — used to detect unmatched scheduled rows vs later imports. */
  accountTimeline: TimelineRow[];
  /** Unfiltered past row count (for "X of Y" when filters are active). */
  totalUnfilteredCount?: number;
  currency: string;
  isCredit: boolean;
  /** Full-height scroll panel */
  expanded: boolean;
  /** Forecast is open — show header only */
  minimized: boolean;
  onToggleExpanded: () => void;
  accountId: number | "";
  onEditRow: (row: import("@budget-app/shared").TimelineRow) => void;
  onEditTransaction: (txn: import("@budget-app/shared").Transaction) => void;
  onDuplicateById: (transactionId: number) => void;
  onDuplicate: (txn: import("@budget-app/shared").Transaction) => void;
  onDeleteRow: (row: import("@budget-app/shared").TimelineRow) => void;
  onDelete: (transactionId: number, label: string) => void;
  deletePending: boolean;
};

export default function PastSection({
  start,
  past,
  accountTimeline,
  totalUnfilteredCount,
  currency,
  isCredit,
  expanded,
  minimized,
  onToggleExpanded,
  accountId,
  onEditRow,
  onEditTransaction,
  onDuplicateById,
  onDuplicate,
  onDeleteRow,
  onDelete,
  deletePending,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fmtBal = (bal: number) => formatCurrency(bal, currency);
  const creditClass = (bal: number) => creditBalanceColorClass(isCredit, bal);

  const showBody = !minimized;

  useEffect(() => {
    if (!showBody) return;
    const el = scrollRef.current;
    if (!el) return;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight - el.clientHeight;
    };
    scrollToBottom();
    const raf = requestAnimationFrame(scrollToBottom);
    const t = setTimeout(scrollToBottom, 50);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [accountId, past.length, expanded, minimized, showBody]);

  const sectionClass =
    minimized || !expanded ? "flex-none shrink-0" : "flex-1 min-h-0";

  return (
    <section className={`flex flex-col overflow-hidden border-b-4 border-gray-300 ${sectionClass}`}>
      <LedgerSectionHeader
        title="Recent Transactions"
        expanded={showBody && expanded}
        onToggleExpanded={onToggleExpanded}
        hasRows={past.length > 0}
        tone="past"
        expandChevron="past"
      />
      {showBody && (
        <>
          <LedgerColumnHeader className="shrink-0" />
          <div
            ref={scrollRef}
            className={`ledger-scroll overflow-y-auto overscroll-y-contain border-b border-gray-100 ${
              expanded ? "flex-1 min-h-0" : ""
            }`}
            style={
              expanded
                ? undefined
                : { height: compactScrollHeight, maxHeight: compactScrollHeight }
            }
          >
            {start?.type === "starting_balance" && (
              <div className={`${LEDGER_TABLE_GRID} px-4 py-2 bg-gray-50 border-b border-gray-100 text-sm`}>
                <span className="text-gray-400 text-xs">—</span>
                <span aria-hidden />
                <span className="font-medium text-gray-600">Starting Balance</span>
                <span aria-hidden />
                <span aria-hidden />
                <span aria-hidden />
                <span className={`text-right font-semibold tabular-nums ${creditClass(start.balance)}`}>
                  {fmtBal(start.balance)}
                </span>
                <span aria-hidden />
              </div>
            )}

            {past.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">
                {totalUnfilteredCount != null && totalUnfilteredCount > 0
                  ? "No transactions match the current filters."
                  : "No past transactions in this range."}
              </p>
            ) : (
              past.map((row) => {
                if (row.type === "transaction_from_timeline") {
                  const data = timelineRowToData(row.row, row.balance, "past");
                  const editable = canEditLedgerTimelineRow(row.row);
                  const scheduleHighlight = shouldHighlightUnmatchedScheduledRow(
                    row.row,
                    accountTimeline
                  );
                  return (
                    <TransactionRow
                      key={data.id}
                      row={data}
                      variant="past"
                      currency={currency}
                      isCredit={isCredit}
                      rowSurface={
                        scheduleHighlight ? unmatchedScheduleRowClasses() : undefined
                      }
                      scheduleHighlightTitle={
                        scheduleHighlight ? UNMATCHED_SCHEDULE_ROW_TITLE : undefined
                      }
                      onEdit={editable ? () => onEditRow(row.row) : undefined}
                      onDuplicate={
                        editable && row.row.transaction_id != null
                          ? () => onDuplicateById(row.row.transaction_id!)
                          : undefined
                      }
                      onDelete={editable ? () => onDeleteRow(row.row) : undefined}
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
                      currency={currency}
                      isCredit={isCredit}
                      onEdit={row.txn.reconciled ? undefined : () => onEditTransaction(row.txn)}
                      onDuplicate={row.txn.reconciled ? undefined : () => onDuplicate(row.txn)}
                      onDelete={
                        row.txn.reconciled
                          ? undefined
                          : () => onDelete(row.txn.id, row.txn.payee)
                      }
                      actionsDisabled={deletePending}
                    />
                  );
                }
                return null;
              })
            )}
          </div>
        </>
      )}
    </section>
  );
}
