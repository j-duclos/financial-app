import { useRef, useEffect } from "react";
import { formatCurrency } from "@budget-app/shared";
import TransactionRow, { timelineRowToData, transactionToData } from "./TransactionRow";
import {
  COLLAPSED_LEDGER_ROWS,
  LEDGER_TABLE_GRID,
  LedgerColumnHeader,
  LedgerSectionHeader,
} from "./ledgerTableLayout";
import { creditBalanceColorClass, type LedgerRow } from "./transactionsLedgerUtils";

export const PAST_SCROLL_MIN_ROWS = COLLAPSED_LEDGER_ROWS;

const ROW_REM = 2.5;
const compactScrollHeight = `${COLLAPSED_LEDGER_ROWS * ROW_REM}rem`;

type Props = {
  start: LedgerRow | null;
  past: LedgerRow[];
  currency: string;
  isCredit: boolean;
  /** Full-height scroll panel */
  expanded: boolean;
  /** Forecast is open — show header only */
  minimized: boolean;
  onToggleExpanded: () => void;
  accountId: number | "";
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
  currency,
  isCredit,
  expanded,
  minimized,
  onToggleExpanded,
  accountId,
  onEditTimeline,
  onEditTransaction,
  onDuplicateById,
  onDuplicate,
  onDelete,
  deletePending,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fmtBal = (bal: number) => formatCurrency(isCredit ? Math.abs(bal) : bal, currency);
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

  const sectionClass = minimized ? "flex-none shrink-0" : "flex-1 min-h-0";

  // #region agent log
  useEffect(() => {
    if (!showBody) return;
    const el = scrollRef.current;
    const sectionEl = el?.parentElement?.parentElement;
    fetch("http://127.0.0.1:7452/ingest/95528d82-8c08-453f-b30d-a47144a4bbc3", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "55db24" },
      body: JSON.stringify({
        sessionId: "55db24",
        location: "PastSection.tsx:layout",
        message: "past section scroll metrics",
        data: {
          expanded,
          minimized,
          pastCount: past.length,
          sectionClass,
          scrollClientHeight: el?.clientHeight ?? null,
          scrollScrollHeight: el?.scrollHeight ?? null,
          scrollGap: el ? el.clientHeight - el.scrollHeight : null,
          sectionClientHeight: sectionEl?.clientHeight ?? null,
        },
        timestamp: Date.now(),
        hypothesisId: "A-B",
      }),
    }).catch(() => {});
  }, [expanded, minimized, past.length, showBody, sectionClass]);
  // #endregion

  return (
    <section className={`flex flex-col overflow-hidden border-b-4 border-gray-300 ${sectionClass}`}>
      <LedgerSectionHeader
        title="Past"
        expanded={showBody && expanded}
        onToggleExpanded={onToggleExpanded}
        totalCount={past.length}
        tone="past"
        expandChevron="past"
      />
      {showBody && (
        <>
          <LedgerColumnHeader className="shrink-0" />
          <div
            ref={scrollRef}
            className="ledger-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain border-b border-gray-100"
            style={expanded ? undefined : { minHeight: compactScrollHeight }}
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
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No past transactions in this range.</p>
            ) : (
              past.map((row) => {
                if (row.type === "transaction_from_timeline") {
                  const data = timelineRowToData(row.row, row.balance, "past");
                  return (
                    <TransactionRow
                      key={data.id}
                      row={data}
                      variant="past"
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
              })
            )}
          </div>
        </>
      )}
    </section>
  );
}
