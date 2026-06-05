import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import type { DashboardSnapshot } from "@budget-app/shared";
import HoverTooltip from "../HoverTooltip";
import { RESOURCE_BREAKDOWN } from "../../lib/dashboardTerminology";
import {
  SNAPSHOT_LINKS,
  SNAPSHOT_UNAVAILABLE,
  cashSnapshotFooter,
  debtDisplayAmount,
  pctTrendClass,
  savingsSnapshotFooter,
  snapshotMetricAvailable,
  utilizationLabel,
} from "../../lib/snapshotDisplay";

type MetricProps = {
  label: string;
  subtitle: string;
  help: string;
  value: string | null;
  footer: ReactNode;
  to: string;
  valueClassName?: string;
};

function footerOrEmpty(node: ReactNode): ReactNode {
  if (node == null || node === false) return null;
  return node;
}

function ResourceMetricCard({
  label,
  subtitle,
  help,
  value,
  footer,
  to,
  valueClassName = "text-gray-900",
}: MetricProps) {
  const available = snapshotMetricAvailable(value);

  return (
    <Link
      to={to}
      className="block h-full min-w-0 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2.5 min-h-[4.25rem] shadow-sm hover:border-gray-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2"
    >
      <div className="flex items-center gap-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
        {help ? (
          <HoverTooltip label={help}>
            <HelpCircle
              className="h-3.5 w-3.5 shrink-0 text-gray-400 hover:text-gray-600"
              aria-hidden
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          </HoverTooltip>
        ) : null}
      </div>
      <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>
      {available ? (
        <p className={`text-lg font-semibold tabular-nums leading-tight mt-1.5 ${valueClassName}`}>
          {formatCurrency(value!)}
        </p>
      ) : (
        <p className="text-xs text-gray-400 mt-1.5">{SNAPSHOT_UNAVAILABLE}</p>
      )}
      {footer ? <div className="mt-0.5 text-xs text-gray-500">{footer}</div> : null}
    </Link>
  );
}

/** Structural account buckets (quieter secondary row on dashboard). */
export default function FinancialSnapshotCard({ snapshot }: { snapshot: DashboardSnapshot }) {
  const util = snapshot.utilization ?? snapshot.credit_utilization ?? null;
  const cashFooter = cashSnapshotFooter(snapshot);
  const savingsFooter = savingsSnapshotFooter(snapshot);
  const creditValue = snapshotMetricAvailable(snapshot.credit_debt)
    ? debtDisplayAmount(snapshot.credit_debt)
    : null;

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full"
      aria-label={RESOURCE_BREAKDOWN.spendingAccounts.label}
    >
      <ResourceMetricCard
        label={RESOURCE_BREAKDOWN.spendingAccounts.label}
        subtitle={RESOURCE_BREAKDOWN.spendingAccounts.subtitle}
        help={RESOURCE_BREAKDOWN.spendingAccounts.help}
        value={snapshot.cash}
        to={SNAPSHOT_LINKS.cash}
        footer={footerOrEmpty(
          cashFooter ? (
            <span className={pctTrendClass(snapshot.cash_change_pct)}>{cashFooter}</span>
          ) : null
        )}
      />
      <ResourceMetricCard
        label={RESOURCE_BREAKDOWN.debtOwed.label}
        subtitle={RESOURCE_BREAKDOWN.debtOwed.subtitle}
        help={RESOURCE_BREAKDOWN.debtOwed.help}
        value={creditValue}
        to={SNAPSHOT_LINKS.debt}
        valueClassName="text-red-700"
        footer={footerOrEmpty(
          utilizationLabel(util) ? (
            <span className="text-gray-600">{utilizationLabel(util)}</span>
          ) : null
        )}
      />
      <ResourceMetricCard
        label={RESOURCE_BREAKDOWN.savingsInvestments.label}
        subtitle={RESOURCE_BREAKDOWN.savingsInvestments.subtitle}
        help={RESOURCE_BREAKDOWN.savingsInvestments.help}
        value={snapshot.savings}
        to={SNAPSHOT_LINKS.savings}
        footer={footerOrEmpty(
          savingsFooter ? (
            <span
              className={
                snapshot.savings_goal_progress_pct
                  ? "text-blue-600"
                  : pctTrendClass(snapshot.savings_change_pct)
              }
            >
              {savingsFooter}
            </span>
          ) : null
        )}
      />
    </div>
  );
}
