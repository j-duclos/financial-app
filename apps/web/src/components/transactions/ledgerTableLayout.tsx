import HoverTooltip from "../HoverTooltip";

export const COLLAPSED_LEDGER_ROWS = 5;

/** Hover + aria text for past/forecast ledger expand controls. */
export function ledgerSectionExpandTooltip(
  kind: "past" | "forecast",
  expanded: boolean
): string {
  const name = kind === "past" ? "past" : "forecast";
  if (expanded) {
    return `Collapse ${name} to a ${COLLAPSED_LEDGER_ROWS}-row preview`;
  }
  if (kind === "past") {
    return "Expand past to full height (forecast shrinks to header)";
  }
  return "Expand forecast to full height (past shrinks to header)";
}

/** Shared column grid: Date | Type | Description | Kind | Category | Amount | Balance | actions */
export const LEDGER_TABLE_GRID =
  "grid grid-cols-[8.5rem_2.5rem_minmax(14rem,1fr)_5rem_minmax(6rem,12rem)_6.5rem_6.5rem_2.75rem] gap-x-3 items-center w-full";

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  totalCount: number;
  tone?: "past" | "entry" | "forecast";
  showExpand?: boolean;
  /** Past: › collapsed / ˅ expanded. Forecast: ˄ collapsed / ˅ expanded. */
  expandChevron?: "past" | "forecast";
  className?: string;
};

const toneStyles = {
  past: { header: "bg-gray-100 border-gray-200 text-gray-700", section: "border-gray-300" },
  entry: { header: "bg-blue-50 border-blue-200 text-blue-900", section: "border-blue-400" },
  forecast: { header: "bg-amber-50 border-amber-200 text-amber-900", section: "border-amber-400" },
};

export function LedgerSectionHeader({
  title,
  subtitle,
  expanded,
  onToggleExpanded,
  totalCount,
  tone = "past",
  showExpand = true,
  expandChevron,
  className = "",
}: SectionHeaderProps) {
  const styles = toneStyles[tone];
  const chevron = expandChevron ?? (tone === "forecast" ? "forecast" : "past");
  const canExpand =
    showExpand && (tone === "entry" ? false : tone === "forecast" ? true : totalCount > 0);
  const expandTip = canExpand ? ledgerSectionExpandTooltip(chevron, expanded) : null;

  return (
    <header
      className={`px-4 py-2 border-b flex items-center justify-between gap-3 shrink-0 ${styles.header} ${className}`}
    >
      <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 className="text-sm font-bold uppercase tracking-wide shrink-0">{title}</h2>
        {tone !== "entry" && totalCount > 0 && (
          <span className="text-xs opacity-70 whitespace-nowrap">
            {totalCount} total — scroll to browse
          </span>
        )}
        {subtitle && (
          <p className="text-xs opacity-80 w-full basis-full">{subtitle}</p>
        )}
      </div>
      {canExpand && expandTip && (
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expandTip}
          title={expandTip}
          className="p-1 rounded-md hover:bg-black/5 border border-transparent hover:border-black/10 shrink-0"
        >
          <HoverTooltip label={expandTip} decorateOnly>
            {chevron === "forecast" ? (
              expanded ? <ChevronDownIcon /> : <ChevronUpIcon />
            ) : expanded ? (
              <ChevronDownIcon />
            ) : (
              <ChevronRightIcon />
            )}
          </HoverTooltip>
        </button>
      )}
    </header>
  );
}

export function LedgerColumnHeader({
  className = "",
  centered = false,
  hideBalance = false,
  hideKind = false,
  hideType = false,
}: {
  className?: string;
  /** Center labels (new-transaction entry row) */
  centered?: boolean;
  /** New-transaction row has no running balance column */
  hideBalance?: boolean;
  /** New-transaction row has no kind column label */
  hideKind?: boolean;
  /** New-transaction row has no type column label */
  hideType?: boolean;
}) {
  const label = centered ? "text-center" : "";
  const amountLabel = centered ? "text-center" : "text-right";
  return (
    <div
      className={`${LEDGER_TABLE_GRID} px-4 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 bg-white ${className}`}
    >
      <span className={label}>Date</span>
      {hideType ? <span aria-hidden /> : <span className={`${label} text-center`}>Type</span>}
      <span className={label}>Description</span>
      {hideKind ? <span aria-hidden /> : <span className={label}>Kind</span>}
      <span className={label}>Category</span>
      <span className={amountLabel}>Amount</span>
      {hideBalance ? <span aria-hidden /> : <span className={amountLabel}>Balance</span>}
      <span aria-hidden />
    </div>
  );
}

function ChevronUpIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}
