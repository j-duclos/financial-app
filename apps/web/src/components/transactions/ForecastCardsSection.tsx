import { useMemo } from "react";
import TransactionRow, { timelineRowToData } from "./TransactionRow";
import {
  COLLAPSED_LEDGER_ROWS,
  LedgerColumnHeader,
  LedgerSectionHeader,
} from "./ledgerTableLayout";
import { forecastRowSeverityClasses } from "./forecastRowSeverity";
import type { LedgerRow } from "./transactionsLedgerUtils";

const ROW_REM = 2.5;
const compactScrollHeight = `${COLLAPSED_LEDGER_ROWS * ROW_REM}rem`;

type Props = {
  future: LedgerRow[];
  currency: string;
  isCredit: boolean;
  isCreditAccount: boolean;
  /** Full-height forecast panel */
  expanded: boolean;
  /** Past is expanded — hide forecast rows (header only) */
  hiddenByPast: boolean;
  onToggleExpanded: () => void;
  onEditTimeline: (transactionId: number) => void;
  onSkip: (transactionId: number, label: string) => void;
  onDelete: (transactionId: number, label: string) => void;
  deletePending: boolean;
  minimumBuffer: number | null;
  riskDate: string | null;
};

export default function ForecastCardsSection({
  future,
  currency,
  isCredit,
  isCreditAccount,
  expanded,
  hiddenByPast,
  onToggleExpanded,
  onEditTimeline,
  onSkip,
  onDelete,
  deletePending,
  minimumBuffer,
  riskDate,
}: Props) {
  const forecastRows = useMemo(
    () => future.filter((row): row is Extract<LedgerRow, { type: "recurring" }> => row.type === "recurring"),
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
          title="Forecast"
          subtitle={
            expanded && isCreditAccount ? "Includes projected interest each billing cycle" : undefined
          }
          expanded={showBody && expanded}
          onToggleExpanded={onToggleExpanded}
          totalCount={forecastRows.length}
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
                const data = timelineRowToData(row.row, row.balance, "future");
                const rowKey =
                  row.row.source === "interest"
                    ? `interest-${row.row.account_id}-${row.row.date}`
                    : row.row.transaction_id != null
                      ? `txn-${row.row.transaction_id}`
                      : row.row.rule_id != null
                        ? `rec-${row.row.rule_id}-${row.row.date}`
                        : `rec-future-${row.row.account_id}-${row.row.date}-${index}`;

                return (
                  <TransactionRow
                    key={rowKey}
                    row={{ ...data, id: rowKey }}
                    variant="future"
                    currency={currency}
                    isCredit={isCredit}
                    forecastSeverity={forecastRowSeverityClasses({
                      balance: row.balance,
                      rowDate: row.row.date,
                      minimumBuffer,
                      riskDate,
                      isCredit,
                    })}
                    onEdit={
                      row.row.transaction_id != null
                        ? () => onEditTimeline(row.row.transaction_id!)
                        : undefined
                    }
                    onSkip={
                      row.row.transaction_id != null
                        ? () => onSkip(row.row.transaction_id!, row.row.description)
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
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
