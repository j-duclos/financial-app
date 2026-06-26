import type { TimelineRow } from "@budget-app/shared";
import TransactionRow, { timelineRowToData } from "./TransactionRow";
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
}: Props) {
  if (pending.length === 0) return null;

  const showBody = !hiddenByPast;

  return (
    <section className="flex-none shrink-0 border-t-4 border-blue-300 bg-blue-50/30">
      <div className="sticky top-0 z-10 shrink-0 bg-blue-50 border-b border-blue-200">
        <LedgerSectionHeader
          title="Expected Transactions"
          subtitle="Scheduled items due now but not confirmed by bank import or manual posting"
          expanded={showBody}
          onToggleExpanded={() => {}}
          tone="entry"
          className="border-b-0 text-blue-900"
        />
        {showBody && <LedgerColumnHeader className="bg-blue-50/80 border-blue-100" />}
      </div>

      {showBody && (
        <div
          className="ledger-scroll overflow-y-auto overscroll-y-contain bg-white"
          style={{ maxHeight: compactScrollHeight }}
        >
          {pending.map((row, index) => {
            if (row.type !== "transaction_from_timeline") return null;
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
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
