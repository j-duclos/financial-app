import { CheckCircle2 } from "lucide-react";
import { formatDateDisplay } from "../../lib/dateDisplay";

type Props = {
  throughDate: string;
};

export default function ReconcileAllCaughtUpCard({ throughDate }: Props) {
  return (
    <div className="bg-white border border-emerald-200 rounded-lg p-8 mb-6 text-center shadow-sm">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 className="h-7 w-7 text-emerald-600" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-gray-900">All transactions have been reconciled</h2>
      <p className="mt-2 text-sm text-gray-600">
        This account is caught up through {formatDateDisplay(throughDate)}. New transactions will appear here when
        they need to be reconciled.
      </p>
    </div>
  );
}
