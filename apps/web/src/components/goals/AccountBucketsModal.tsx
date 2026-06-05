import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatCurrency } from "@budget-app/shared";
import { getAccountBucketAllocations } from "@budget-app/api-client";

type Props = {
  accountId: number;
  accountName: string;
  open: boolean;
  onClose: () => void;
};

export default function AccountBucketsModal({ accountId, accountName, open, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["account-bucket-allocations", accountId],
    queryFn: () => getAccountBucketAllocations(accountId),
    enabled: open,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="p-5 space-y-4">
          <div className="flex justify-between items-start gap-2">
            <div>
              <h2 className="text-lg font-semibold">Goal buckets</h2>
              <p className="text-sm text-gray-500">{accountName}</p>
            </div>
            <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-800">
              Close
            </button>
          </div>

          {isLoading && <p className="text-sm text-gray-500">Loading allocations…</p>}

          {data && (
            <>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-gray-500 text-xs">Balance</dt>
                  <dd className="font-medium">{formatCurrency(data.balance)}</dd>
                </div>
                <div>
                  <dt className="text-gray-500 text-xs">Allocated</dt>
                  <dd className="font-medium text-indigo-800">
                    {formatCurrency(data.allocated_total)}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500 text-xs">Available</dt>
                  <dd className="font-medium text-emerald-800">
                    {formatCurrency(data.available_unallocated)}
                  </dd>
                </div>
              </dl>

              {data.buckets.length === 0 ? (
                <p className="text-sm text-gray-600">No goal buckets linked to this account.</p>
              ) : (
                <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
                  {data.buckets.map((b) => (
                    <li key={b.id} className="px-3 py-2.5 text-sm flex justify-between gap-2">
                      <span className="font-medium text-gray-900 truncate">{b.name}</span>
                      <span className="text-gray-600 shrink-0">
                        {formatCurrency(b.allocated_amount)} / {formatCurrency(b.target_amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <Link
                to="/goals"
                className="inline-block text-sm text-blue-600 hover:underline"
                onClick={onClose}
              >
                Manage goals
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
