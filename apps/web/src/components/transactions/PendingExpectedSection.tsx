import { useMemo } from "react";
import type { TimelineRow } from "@budget-app/shared";
import TransactionRow, { canSelectTransactionForBatchDelete, timelineRowToData } from "./TransactionRow";
import {
  COLLAPSED_LEDGER_ROWS,
  LedgerColumnHeader,
  LedgerSectionHeader,
} from "./ledgerTableLayout";
import {
  canEditLedgerTimelineRow,
  shouldHighlightUnmatchedScheduledRow,
  type LedgerRow,
} from "./transactionsLedgerUtils";
import { unmatchedScheduleRowClasses, UNMATCHED_SCHEDULE_ROW_TITLE } from "./forecastRowSeverity";

const ROW_REM = 2.5;
const compactScrollHeight = `${Math.min(COLLAPSED_LEDGER_ROWS, 4) * ROW_REM}rem`;

type Props = {
  pending: LedgerRow[];
  accountTimeline: TimelineRow[];
  currency: string;
  isCredit: boolean;
  hiddenByPast: boolean;
  onEditRow: (row: TimelineRow) => void;
  onConfirmRow: (row: TimelineRow) => void;
  onSkipRow: (row: TimelineRow) => void;
  onMoveDateRow: (row: TimelineRow) => void;
  onMatchRow: (row: TimelineRow) => void;
  onDeleteRow: (row: TimelineRow) => void;
  actionsPending: boolean;
  selectedIds: Set<number>;
  onToggleSelected: (transactionId: number, selected: boolean) => void;
  onSetSelectedIds: (ids: number[], selected: boolean) => void;
};

/**
 * Scheduled/rule rows whose date has arrived but no actual bank/manual posting has confirmed them.
 * Resolved via Confirm, Skip, Edit, Move Date, or Match — not manual delete.
 */
export default function PendingExpectedSection({
  pending,
  accountTimeline,
  currency,
  isCredit,
  hiddenByPast,
  onEditRow,
  onConfirmRow,
  onSkipRow,
  onMoveDateRow,
  onMatchRow,
  onDeleteRow,
  actionsPending,
  selectedIds,
  onToggleSelected,
  onSetSelectedIds,
}: Props) {
  const displayable = useMemo(
    () => pending.filter((row) => row.type === "transaction_from_timeline"),
    [pending]
  );
  const selectableIds = useMemo(() => {
    const ids: number[] = [];
    for (const row of displayable) {
      const data = timelineRowToData(row.row, row.balance, "expected");
      if (canSelectTransactionForBatchDelete(data) && data.transactionId != null) {
        ids.push(data.transactionId);
      }
    }
    return ids;
  }, [displayable]);
  const selectedInSection = selectableIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedInSection === selectableIds.length;
  const someSelected = selectedInSection > 0 && !allSelected;

  if (displayable.length === 0 || hiddenByPast) return null;

  return (
    <section className="flex-none shrink-0 border-t-4 border-blue-300 bg-blue-50/30">
      <div className="sticky top-0 z-10 shrink-0 bg-blue-50 border-b border-blue-200">
        <LedgerSectionHeader
          title="Pending Transactions"
          subtitle="Scheduled items due now but not confirmed by bank import or manual posting"
          expanded
          onToggleExpanded={() => {}}
          tone="entry"
          className="border-b-0 text-blue-900"
        />
        <LedgerColumnHeader
          className="bg-blue-50/80 border-blue-100"
          selectAllChecked={allSelected}
          selectAllIndeterminate={someSelected}
          selectAllDisabled={actionsPending || selectableIds.length === 0}
          onSelectAllChange={(checked) => onSetSelectedIds(selectableIds, checked)}
        />
      </div>

      <div
        className="ledger-scroll overflow-y-auto overscroll-y-contain bg-white"
        style={{ maxHeight: compactScrollHeight }}
      >
        {displayable.map((row, index) => {
            const data = timelineRowToData(row.row, row.balance, "expected");
            const rowKey =
              row.row.transaction_id != null
                ? `pending-txn-${row.row.transaction_id}`
                : row.row.rule_id != null
                  ? `pending-rule-${row.row.rule_id}-${row.row.account_id}-${row.row.date}`
                  : `pending-${row.row.account_id}-${row.row.date}-${index}`;
            const editable = canEditLedgerTimelineRow(row.row);
            const scheduleHighlight = shouldHighlightUnmatchedScheduledRow(row.row, accountTimeline);
            return (
              <TransactionRow
                key={rowKey}
                row={{ ...data, id: rowKey }}
                variant="expected"
                currency={currency}
                isCredit={isCredit}
                rowSurface={unmatchedScheduleRowClasses()}
                scheduleHighlightTitle={
                  scheduleHighlight ? UNMATCHED_SCHEDULE_ROW_TITLE : "Expected transaction waiting for confirmation"
                }
                onConfirm={editable ? () => onConfirmRow(row.row) : undefined}
                onEdit={editable ? () => onEditRow(row.row) : undefined}
                onSkip={editable ? () => onSkipRow(row.row) : undefined}
                onMoveDate={editable ? () => onMoveDateRow(row.row) : undefined}
                onMatch={editable ? () => onMatchRow(row.row) : undefined}
                showMatch
                onDelete={editable ? () => onDeleteRow(row.row) : undefined}
                actionsDisabled={actionsPending}
                selected={
                  data.transactionId != null ? selectedIds.has(data.transactionId) : false
                }
                onSelectedChange={onToggleSelected}
              />
            );
          })}
      </div>
    </section>
  );
}
