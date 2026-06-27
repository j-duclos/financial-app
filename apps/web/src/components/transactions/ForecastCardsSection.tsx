import { useMemo } from "react";
import type { TimelineRow, Transaction } from "@budget-app/shared";
import TransactionRow, { timelineRowToData, transactionToData } from "./TransactionRow";
import {
  COLLAPSED_LEDGER_ROWS,
  LedgerColumnHeader,
  LedgerSectionHeader,
} from "./ledgerTableLayout";
import {
  forecastRowSeverityClasses,
  unmatchedScheduleRowClasses,
  UNMATCHED_SCHEDULE_ROW_TITLE,
} from "./forecastRowSeverity";
import {
  canEditLedgerTimelineRow,
  shouldHighlightUnmatchedScheduledRow,
  type LedgerRow,
} from "./transactionsLedgerUtils";

const ROW_REM = 2.5;
const compactScrollHeight = `${COLLAPSED_LEDGER_ROWS * ROW_REM}rem`;

type Props = {
  future: LedgerRow[];
  /** Full account timeline — used to detect unmatched scheduled rows vs later imports. */
  accountTimeline: TimelineRow[];
  currency: string;
  isCredit: boolean;
  isCreditAccount: boolean;
  /** Full-height forecast panel */
  expanded: boolean;
  /** Past is expanded — hide forecast rows (header only) */
  hiddenByPast: boolean;
  onToggleExpanded: () => void;
  onEditRow: (row: TimelineRow) => void;
  onEditTransaction: (txn: Transaction) => void;
  onSkipRow: (row: TimelineRow) => void;
  onDeleteRow: (row: TimelineRow) => void;
  onDeleteTransaction: (transactionId: number, label: string) => void;
  deletePending: boolean;
  minimumBuffer: number | null;
};

export default function ForecastCardsSection({
  future,
  accountTimeline,
  currency,
  isCredit,
  isCreditAccount,
  expanded,
  hiddenByPast,
  onToggleExpanded,
  onEditRow,
  onEditTransaction,
  onSkipRow,
  onDeleteRow,
  onDeleteTransaction,
  deletePending,
  minimumBuffer,
}: Props) {
  const forecastRows = useMemo(
    () =>
      future.filter(
        (row): row is Extract<LedgerRow, { type: "recurring" } | { type: "transaction" }> =>
          row.type === "recurring" || row.type === "transaction"
      ),
    [future]
  );

  const showBody = !hiddenByPast;
  const sectionClass = hiddenByPast
    ? "flex-none shrink-0"
    : expanded
      ? "flex-1 min-h-0"
      : "flex-none shrink-0";

  return (
    <section className={`flex flex-col border-t-4 border-amber-400 min-h-0 overflow-hidden ${sectionClass}`}>
      <div className="sticky top-0 z-10 shrink-0 bg-amber-50 border-b border-amber-200">
        <LedgerSectionHeader
          title="Upcoming Transactions"
          subtitle={
            expanded && isCreditAccount ? "Includes projected interest each billing cycle" : undefined
          }
          expanded={showBody && expanded}
          onToggleExpanded={onToggleExpanded}
          tone="forecast"
          expandChevron="forecast"
          className="border-b-0"
        />
        {showBody && <LedgerColumnHeader className="bg-amber-50/80 border-amber-100" />}
      </div>

      {showBody && (
        <>
          {forecastRows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-amber-800 text-center">No future transactions in this time range.</p>
          ) : (
            <div
              className={`ledger-scroll min-h-0 overflow-y-scroll overscroll-y-contain bg-white ${
                expanded ? "flex-1" : ""
              }`}
              style={
                expanded
                  ? { minHeight: compactScrollHeight }
                  : { height: compactScrollHeight, maxHeight: compactScrollHeight }
              }
            >
              {forecastRows.map((row, index) => {
                if (row.type === "transaction") {
                  const data = transactionToData(row.txn, row.balance);
                  const editable = !row.txn.reconciled;
                  return (
                    <TransactionRow
                      key={`future-txn-${row.txn.id}`}
                      row={data}
                      variant="future"
                      currency={currency}
                      isCredit={isCredit}
                      rowSurface={forecastRowSeverityClasses({
                        balance: row.balance,
                        rowDate: row.txn.date,
                        minimumBuffer,
                        isCredit,
                      })}
                      onEdit={editable ? () => onEditTransaction(row.txn) : undefined}
                      onDelete={
                        editable
                          ? () => onDeleteTransaction(row.txn.id, row.txn.payee || row.txn.date)
                          : undefined
                      }
                      actionsDisabled={deletePending}
                    />
                  );
                }

                const data = timelineRowToData(row.row, row.balance, "future");
                const rowKey =
                  row.row.source === "interest"
                    ? `interest-${row.row.account_id}-${row.row.date}`
                    : row.row.transaction_id != null
                      ? `txn-${row.row.transaction_id}`
                      : row.row.rule_id != null
                        ? `rec-${row.row.rule_id}-${row.row.date}`
                        : `rec-future-${row.row.account_id}-${row.row.date}-${index}`;

                const editable = canEditLedgerTimelineRow(row.row);

                const scheduleHighlight = shouldHighlightUnmatchedScheduledRow(row.row, accountTimeline);
                const rowSurface = scheduleHighlight
                  ? unmatchedScheduleRowClasses(
                      forecastRowSeverityClasses({
                        balance: row.balance,
                        rowDate: row.row.date,
                        minimumBuffer,
                        isCredit,
                      })
                    )
                  : forecastRowSeverityClasses({
                      balance: row.balance,
                      rowDate: row.row.date,
                      minimumBuffer,
                      isCredit,
                    });

                return (
                  <TransactionRow
                    key={rowKey}
                    row={{ ...data, id: rowKey }}
                    variant="future"
                    currency={currency}
                    isCredit={isCredit}
                    rowSurface={rowSurface}
                    scheduleHighlightTitle={scheduleHighlight ? UNMATCHED_SCHEDULE_ROW_TITLE : undefined}
                    onEdit={editable ? () => onEditRow(row.row) : undefined}
                    onSkip={editable ? () => onSkipRow(row.row) : undefined}
                    onDelete={editable ? () => onDeleteRow(row.row) : undefined}
                    actionsDisabled={deletePending}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
