import { formatCurrency } from "@budget-app/shared";
import TransactionSourceBadge from "./TransactionSourceBadge";
import TransactionContextMenu from "./TransactionContextMenu";
import { categoryLabel, formatDateDisplay, type LedgerRow, type ViewMode } from "./transactionsLedgerUtils";

type Props = {
  future: LedgerRow[];
  viewMode: ViewMode;
  currency: string;
  isCredit: boolean;
  isCreditAccount: boolean;
  collapsed: boolean;
  panelFocus: "split" | "past" | "future";
  onExpandPast: () => void;
  onBalancedLayout: () => void;
  onShowFuture: () => void;
  onEditTimeline: (transactionId: number) => void;
  onMove: (transactionId: number) => void;
  onSkip: (transactionId: number, label: string) => void;
  onDelete: (transactionId: number, label: string) => void;
  deletePending: boolean;
};

export default function ForecastCardsSection({
  future,
  viewMode,
  currency,
  isCredit,
  isCreditAccount,
  collapsed,
  panelFocus,
  onExpandPast,
  onBalancedLayout,
  onShowFuture,
  onEditTimeline,
  onMove,
  onSkip,
  onDelete,
  deletePending,
}: Props) {
  if (future.length === 0) {
    return (
      <section className="flex-1 min-h-0 border-t-4 border-amber-400 bg-amber-50/20 px-4 py-6 text-center text-sm text-amber-800">
        No future transactions in this time range.
      </section>
    );
  }

  if (collapsed) {
    return (
      <section className="flex-none border-t-4 border-amber-400">
        <button
          type="button"
          onClick={onShowFuture}
          className="w-full px-4 py-2 bg-amber-50 text-sm font-semibold text-amber-900 flex items-center justify-between hover:bg-amber-100/80"
        >
          Forecast ({future.length} items hidden)
          <ChevronDown />
        </button>
      </section>
    );
  }

  const fmtBal = (bal: number) => formatCurrency(isCredit ? Math.abs(bal) : bal, currency);

  return (
    <section className="flex-1 min-h-0 flex flex-col border-t-4 border-amber-400">
      <header className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-sm font-bold text-amber-900 uppercase tracking-wide">Forecast</h2>
          {isCreditAccount && (
            <p className="text-xs text-amber-700">Includes projected interest each billing cycle</p>
          )}
        </div>
        {panelFocus === "split" ? (
          <IconButton label="Expand past" onClick={onExpandPast}>
            <ChevronUp />
          </IconButton>
        ) : (
          <IconButton label="Balanced layout" onClick={onBalancedLayout}>
            <ChevronDown />
          </IconButton>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-2">
        {future.map((row) => {
          if (row.type !== "recurring") return null;
          const r = row.row;
          const amt = parseFloat(r.amount);
          const isOutflow = r.type === "OUTFLOW" || r.type === "EXPENSE";
          const readOnly = r.source === "interest";
          const rowKey =
            r.source === "interest" ? `interest-${r.account_id}-${r.date}` : `rec-${r.rule_id}-${r.date}`;

          if (viewMode === "balance") {
            return (
              <ForecastListRow
                key={rowKey}
                date={r.date}
                payee={r.description}
                category={categoryLabel(r.category_name, r.description)}
                amount={amt}
                isOutflow={isOutflow}
                balance={row.balance}
                fmtBal={fmtBal}
                currency={currency}
                readOnly={readOnly}
                transactionId={r.transaction_id}
                onEditTimeline={onEditTimeline}
                onMove={onMove}
                onSkip={onSkip}
                onDelete={onDelete}
                deletePending={deletePending}
              />
            );
          }

          return (
            <article
              key={rowKey}
              className="rounded-lg border border-amber-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <time className="text-xs font-medium text-amber-800">{formatDateDisplay(r.date)}</time>
                  <h3 className="text-sm font-semibold text-gray-900 mt-0.5">{r.description}</h3>
                  <p className="text-xs text-gray-500">{categoryLabel(r.category_name, r.description)}</p>
                  <div className="mt-1.5">
                    <TransactionSourceBadge
                      source={r.source}
                      rule_id={r.rule_id}
                      type={r.type}
                      category_name={r.category_name}
                      description={r.description}
                    />
                  </div>
                </div>
                <TransactionContextMenu
                  variant="future"
                  readOnly={readOnly}
                  disabled={deletePending}
                  onEdit={r.transaction_id != null ? () => onEditTimeline(r.transaction_id!) : undefined}
                  onMove={r.transaction_id != null ? () => onMove(r.transaction_id!) : undefined}
                  onSkip={
                    r.transaction_id != null ? () => onSkip(r.transaction_id!, r.description) : undefined
                  }
                  onDelete={
                    r.transaction_id != null ? () => onDelete(r.transaction_id!, r.description) : undefined
                  }
                />
              </div>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={`text-base font-semibold tabular-nums ${isOutflow ? "text-red-600" : "text-green-600"}`}>
                  {isOutflow ? `- ${formatCurrency(Math.abs(amt), currency)}` : formatCurrency(Math.abs(amt), currency)}
                </span>
                <span className="text-xs text-gray-400">balance after</span>
                <span className="text-base font-bold tabular-nums text-gray-900">{fmtBal(row.balance)}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ForecastListRow({
  date,
  payee,
  category,
  amount,
  isOutflow,
  balance,
  fmtBal,
  currency,
  readOnly,
  transactionId,
  onEditTimeline,
  onMove,
  onSkip,
  onDelete,
  deletePending,
}: {
  date: string;
  payee: string;
  category: string;
  amount: number;
  isOutflow: boolean;
  balance: number;
  fmtBal: (n: number) => string;
  currency: string;
  readOnly: boolean;
  transactionId: number | null;
  onEditTimeline: (id: number) => void;
  onMove: (id: number) => void;
  onSkip: (id: number, label: string) => void;
  onDelete: (id: number, label: string) => void;
  deletePending: boolean;
}) {
  return (
    <article className="flex items-center gap-3 px-3 py-2 rounded-lg border border-amber-100 bg-amber-50/40">
      <span className="w-24 font-bold tabular-nums text-gray-900 shrink-0">{fmtBal(balance)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500">{formatDateDisplay(date)} · {category}</p>
        <p className="text-sm font-medium truncate">{payee}</p>
      </div>
      <span className={`text-sm font-medium tabular-nums ${isOutflow ? "text-red-600" : "text-green-600"}`}>
        {isOutflow ? `- ${formatCurrency(Math.abs(amount), currency)}` : formatCurrency(Math.abs(amount), currency)}
      </span>
      <TransactionContextMenu
        variant="future"
        readOnly={readOnly}
        disabled={deletePending}
        onEdit={transactionId != null ? () => onEditTimeline(transactionId) : undefined}
        onMove={transactionId != null ? () => onMove(transactionId) : undefined}
        onSkip={transactionId != null ? () => onSkip(transactionId, payee) : undefined}
        onDelete={transactionId != null ? () => onDelete(transactionId, payee) : undefined}
      />
    </article>
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
      className="p-1 rounded-md text-amber-900 hover:bg-amber-100/80"
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