import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listProjectedFundsAlerts, patchProjectedFundsAlert } from "@budget-app/api-client";
import {
  PROJECTED_FUNDS_ALERTS_QUERY_KEY,
  activeProjectedFundsAlerts,
  projectedFundsForecastPath,
  projectedFundsLedgerPath,
  type ProjectedFundsAlert,
} from "@budget-app/shared";
import { ProjectedFundsAlertDetail } from "./ProjectedFundsAlertBanner";

export default function ProjectedFundsActionList({ highlightId }: { highlightId?: number | null }) {
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState<ProjectedFundsAlert | null>(null);
  const { data } = useQuery({
    queryKey: [...PROJECTED_FUNDS_ALERTS_QUERY_KEY, "active"],
    queryFn: () => listProjectedFundsAlerts({ active: true, page_size: 50 }),
    staleTime: 60_000,
  });
  const alerts = useMemo(() => activeProjectedFundsAlerts(data?.results), [data]);
  const mark = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { read?: boolean; dismissed?: boolean } }) =>
      patchProjectedFundsAlert(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...PROJECTED_FUNDS_ALERTS_QUERY_KEY] });
    },
  });

  if (alerts.length === 0 && !detail) return null;

  return (
    <section data-testid="projected-funds-action-list" className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">Projected insufficient funds</h2>
      <ul className="space-y-2">
        {alerts.map((alert) => (
          <li
            key={alert.id}
            className={`rounded-lg border p-3 bg-white ${
              highlightId === alert.id ? "border-amber-400 ring-1 ring-amber-200" : "border-amber-200"
            }`}
          >
            <p className="text-sm font-medium text-gray-900">{alert.title}</p>
            <p className="text-xs text-gray-600 mt-1">{alert.body}</p>
            <p className="text-xs text-amber-800 mt-1">Shortfall: {alert.shortfall_display}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs font-medium text-blue-700 hover:underline"
                onClick={() => {
                  setDetail(alert);
                  mark.mutate({ id: alert.id, body: { read: true } });
                }}
              >
                View details
              </button>
              <Link to={projectedFundsLedgerPath(alert)} className="text-xs text-blue-700 hover:underline">
                View in ledger
              </Link>
              <Link to={projectedFundsForecastPath(alert)} className="text-xs text-blue-700 hover:underline">
                View forecast
              </Link>
              <button
                type="button"
                className="text-xs text-gray-600 hover:underline"
                onClick={() => mark.mutate({ id: alert.id, body: { dismissed: true } })}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
      {detail ? (
        <ProjectedFundsAlertDetail
          alert={detail}
          onClose={() => setDetail(null)}
          onDismiss={() => {
            mark.mutate({ id: detail.id, body: { dismissed: true } });
            setDetail(null);
          }}
        />
      ) : null}
    </section>
  );
}
