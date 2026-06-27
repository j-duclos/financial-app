import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import type { DashboardSnapshot } from "@budget-app/shared";
import { debtDisplayAmount } from "../../lib/snapshotDisplay";

type Props = {
  snapshot: DashboardSnapshot;
};

/** One-line structural snapshot — links to Accounts for detail. */
export default function DashboardFinancialSnapshotLine({ snapshot }: Props) {
  const cash = parseFloat(snapshot.cash || "0");
  const savings = parseFloat(snapshot.savings || "0");
  const debtOwed = parseFloat(snapshot.credit_debt || "0");
  const net = cash + savings - debtOwed;

  const segments = [
    { label: "Cash", value: snapshot.cash, className: "text-gray-900" },
    {
      label: "Debt",
      value: debtDisplayAmount(snapshot.credit_debt),
      className: "text-red-700",
    },
    { label: "Savings", value: snapshot.savings, className: "text-gray-900" },
    {
      label: "Net Position",
      value: String(net.toFixed(2)),
      className: net >= 0 ? "text-gray-900" : "text-red-700",
    },
  ] as const;

  return (
    <section
      aria-label="Financial snapshot"
      className="rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2"
    >
      <Link
        to="/accounts"
        className="block text-xs text-gray-600 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2 rounded"
      >
        <p className="flex flex-wrap items-baseline gap-x-1 gap-y-1">
          {segments.map((seg, index) => (
            <span key={seg.label} className="inline-flex items-baseline gap-1">
              {index > 0 ? (
                <span className="text-gray-300 px-0.5" aria-hidden>
                  ·
                </span>
              ) : null}
              <span className="text-gray-500">{seg.label}</span>
              <span className={`font-semibold tabular-nums ${seg.className}`}>
                {formatCurrency(seg.value)}
              </span>
            </span>
          ))}
        </p>
      </Link>
    </section>
  );
}
