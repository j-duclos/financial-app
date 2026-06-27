import type { TransactionKind } from "./transactionKindUtils";
import { TRANSACTION_KIND_OPTIONS, type ReconciledFilter } from "./ledgerRowFilters";

type HideReconciledProps = {
  hideReconciledPast: boolean;
  onHideReconciledPastChange: (hide: boolean) => void;
};

export function HideReconciledFilter({
  hideReconciledPast,
  onHideReconciledPastChange,
}: HideReconciledProps) {
  return (
    <div className="flex flex-col justify-end w-full sm:w-auto">
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none pb-1.5">
        <input
          type="checkbox"
          checked={hideReconciledPast}
          onChange={(e) => onHideReconciledPastChange(e.target.checked)}
          className="rounded border-gray-300"
        />
        Hide reconciled
      </label>
    </div>
  );
}

type ColumnFiltersProps = {
  kindFilter: TransactionKind | "";
  onKindFilterChange: (kind: TransactionKind | "") => void;
  reconciledFilter: ReconciledFilter;
  onReconciledFilterChange: (value: ReconciledFilter) => void;
  amountMin: string;
  amountMax: string;
  onAmountMinChange: (value: string) => void;
  onAmountMaxChange: (value: string) => void;
  onClear: () => void;
  showClear: boolean;
};

export function TransactionColumnFilters({
  kindFilter,
  onKindFilterChange,
  reconciledFilter,
  onReconciledFilterChange,
  amountMin,
  amountMax,
  onAmountMinChange,
  onAmountMaxChange,
  onClear,
  showClear,
}: ColumnFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 w-full sm:w-auto">
      <div className="min-w-[7rem] flex-1 sm:flex-none">
        <label className="block text-xs font-medium text-gray-500 mb-0.5">Reconciled</label>
        <select
          value={reconciledFilter}
          onChange={(e) => onReconciledFilterChange(e.target.value as ReconciledFilter)}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All</option>
          <option value="unreconciled">Unreconciled</option>
          <option value="reconciled">Reconciled</option>
        </select>
      </div>
      <div className="min-w-[7rem] flex-1 sm:flex-none">
        <label className="block text-xs font-medium text-gray-500 mb-0.5">Type</label>
        <select
          value={kindFilter}
          onChange={(e) => onKindFilterChange(e.target.value as TransactionKind | "")}
          className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">All types</option>
          {TRANSACTION_KIND_OPTIONS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-[10rem] flex-1 sm:flex-none">
        <label className="block text-xs font-medium text-gray-500 mb-0.5">Amount</label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Min"
            value={amountMin}
            onChange={(e) => onAmountMinChange(e.target.value)}
            className="w-full min-w-0 sm:w-20 rounded border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
            aria-label="Minimum amount"
          />
          <span className="text-xs text-gray-400 shrink-0">–</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Max"
            value={amountMax}
            onChange={(e) => onAmountMaxChange(e.target.value)}
            className="w-full min-w-0 sm:w-20 rounded border border-gray-300 px-2 py-1.5 text-sm tabular-nums"
            aria-label="Maximum amount"
          />
        </div>
      </div>
      {showClear && (
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 self-end"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

type Props = HideReconciledProps & ColumnFiltersProps;

/** @deprecated Prefer HideReconciledFilter + TransactionColumnFilters for responsive layouts. */
export default function TransactionsFilterBar(props: Props) {
  return (
    <>
      <HideReconciledFilter
        hideReconciledPast={props.hideReconciledPast}
        onHideReconciledPastChange={props.onHideReconciledPastChange}
      />
      <TransactionColumnFilters {...props} />
    </>
  );
}
