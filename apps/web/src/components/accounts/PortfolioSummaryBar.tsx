import { formatCurrency } from "@budget-app/shared";
import type { PortfolioSummary } from "../../lib/portfolioSummary";

type TileProps = {
  label: string;
  value: number;
  subtitle: string | null;
  currency: string;
  valueClassName?: string;
};

function PortfolioTile({
  label,
  value,
  subtitle,
  currency,
  valueClassName = "text-gray-900",
}: TileProps) {
  return (
    <div className="min-w-0 rounded-md border border-gray-200 bg-gray-50/80 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 truncate">
        {label}
      </p>
      <p className={`text-base font-semibold tabular-nums leading-tight mt-1 ${valueClassName}`}>
        {formatCurrency(String(value.toFixed(2)), currency)}
      </p>
      {subtitle ? (
        <p className="text-[11px] text-gray-500 mt-0.5 truncate" title={subtitle}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

function spendingSubtitle(summary: PortfolioSummary["spending"]): string | null {
  if (summary.totalSafeToSpend > 0) {
    return `Safe to spend ${formatCurrency(String(summary.totalSafeToSpend.toFixed(2)), summary.currency)}`;
  }
  if (summary.lowestProjected != null) {
    return `Lowest projected ${formatCurrency(String(summary.lowestProjected.toFixed(2)), summary.currency)}`;
  }
  return null;
}

function savingsSubtitle(summary: PortfolioSummary["savings"]): string | null {
  if (summary.count === 0) return null;
  if (summary.totalSafeToSpend > 0) {
    return `Available after buffer ${formatCurrency(String(summary.totalSafeToSpend.toFixed(2)), summary.currency)}`;
  }
  return `${summary.count} account${summary.count === 1 ? "" : "s"}`;
}

function debtSubtitle(summary: PortfolioSummary["debt"]): string | null {
  if (summary.count === 0 || summary.totalDebt <= 0) return null;
  if (summary.avgUtilization != null) {
    return `Avg utilization ${summary.avgUtilization.toFixed(0)}%`;
  }
  return `${summary.count} account${summary.count === 1 ? "" : "s"}`;
}

type Props = {
  summary: PortfolioSummary;
};

/** Compact high-level totals for the Accounts page (not a duplicate of every group header). */
export default function PortfolioSummaryBar({ summary }: Props) {
  const { currency } = summary;
  const debtDisplay = -Math.abs(summary.debt.displayTotal);

  return (
    <section
      aria-label="Portfolio Summary"
      className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm px-3 py-3"
      data-testid="portfolio-summary-bar"
    >
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Portfolio Summary
        </h2>
        <p className="text-[11px] text-gray-400 mt-0.5">Grouped by account role</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <PortfolioTile
          label="Spending Accounts"
          value={summary.spending.displayTotal}
          subtitle={spendingSubtitle(summary.spending)}
          currency={currency}
        />
        <PortfolioTile
          label="Savings"
          value={summary.savings.displayTotal}
          subtitle={savingsSubtitle(summary.savings)}
          currency={currency}
        />
        <PortfolioTile
          label="Debt"
          value={debtDisplay}
          subtitle={debtSubtitle(summary.debt)}
          currency={currency}
          valueClassName="text-red-700"
        />
        <PortfolioTile
          label="Net Position"
          value={summary.netPosition}
          subtitle="Cash + savings − debt"
          currency={currency}
          valueClassName={summary.netPosition >= 0 ? "text-gray-900" : "text-red-700"}
        />
      </div>
    </section>
  );
}
