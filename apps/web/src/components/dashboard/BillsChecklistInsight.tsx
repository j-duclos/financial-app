import { Link } from "react-router-dom";
import type { DashboardBillsSummary } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";

export default function BillsChecklistInsight({ bills }: { bills: DashboardBillsSummary }) {
  if (!bills.total_count && !bills.missed_count && !(bills.late_count ?? 0)) {
    return null;
  }

  const missed = bills.late_count ?? bills.missed_count ?? 0;
  const forgotten = bills.forgotten_count ?? 0;
  const url = bills.checklist_url.startsWith("/")
    ? bills.checklist_url
    : `/recurring?month=${bills.month}`;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{bills.label}</p>
          {bills.total_remaining && parseFloat(bills.total_remaining) > 0 && (
            <p className="text-xs text-gray-600 mt-0.5">
              {formatCurrency(bills.total_remaining)} remaining this month
            </p>
          )}
          {bills.missed_message && (
            <p className="text-sm text-red-600 mt-0.5">{bills.missed_message}</p>
          )}
          {forgotten > 0 && !bills.missed_message && (
            <p className="text-sm text-amber-700 mt-0.5">
              {forgotten} bill{forgotten !== 1 ? "s" : ""} may be forgotten
            </p>
          )}
        </div>
        <Link
          to={url}
          className="text-sm font-medium text-blue-600 hover:text-blue-800 shrink-0"
        >
          View bill checklist
        </Link>
      </div>
      {missed > 0 && (
        <p className="text-xs text-gray-500">
          {missed} missed · {bills.paid_count} of {bills.total_count} paid
        </p>
      )}
    </div>
  );
}
