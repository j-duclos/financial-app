import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  listProjectedFundsAlerts,
  patchProjectedFundsAlert,
} from "@budget-app/api-client";
import {
  PROJECTED_FUNDS_ALERTS_QUERY_KEY,
  projectedFundsForecastPath,
  projectedFundsLedgerPath,
  unreadProjectedFundsAlerts,
  type ProjectedFundsAlert,
} from "@budget-app/shared";
import { useProfileQuery } from "../lib/profileQuery";

const SESSION_KEY = "projected-funds-banner-dismissed-ids";

function sessionDismissed(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as number[]) : [];
    return new Set(parsed.filter((n) => Number.isFinite(n)));
  } catch {
    return new Set();
  }
}

function rememberSessionDismiss(id: number) {
  const next = sessionDismissed();
  next.add(id);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify([...next]));
}

export default function ProjectedFundsAlertBanner() {
  const queryClient = useQueryClient();
  const { data: profile } = useProfileQuery();
  const webEnabled = profile?.projected_funds_web_alerts !== false && profile?.projected_funds_alerts_enabled !== false;
  const [detail, setDetail] = useState<ProjectedFundsAlert | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(() => sessionDismissed());

  const { data } = useQuery({
    queryKey: [...PROJECTED_FUNDS_ALERTS_QUERY_KEY, "unread"],
    queryFn: () => listProjectedFundsAlerts({ active: true, unread: true, page_size: 20 }),
    staleTime: 60_000,
    enabled: webEnabled,
  });

  const mark = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { read?: boolean; dismissed?: boolean } }) =>
      patchProjectedFundsAlert(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...PROJECTED_FUNDS_ALERTS_QUERY_KEY] });
    },
  });

  const alert = unreadProjectedFundsAlerts(data?.results).find((item) => !hiddenIds.has(item.id)) ?? null;
  if (!webEnabled || (!alert && !detail)) return null;

  function hideLocally(id: number) {
    rememberSessionDismiss(id);
    setHiddenIds(sessionDismissed());
  }

  return (
    <>
      {alert ? (
        <div
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 flex flex-wrap items-center justify-between gap-2"
          role="status"
          data-testid="projected-funds-banner"
        >
          <p className="text-sm text-amber-950">{alert.banner_message}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-sm font-medium text-amber-950 underline"
              onClick={() => {
                setDetail(alert);
                mark.mutate({ id: alert.id, body: { read: true } });
              }}
            >
              View details
            </button>
            <Link to="/action-center" className="text-sm text-amber-900 hover:underline">
              Action Center
            </Link>
            <button
              type="button"
              className="text-sm text-amber-800 hover:underline"
              onClick={() => {
                hideLocally(alert.id);
                mark.mutate({ id: alert.id, body: { dismissed: true } });
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {detail ? (
        <ProjectedFundsAlertDetail
          alert={detail}
          onClose={() => setDetail(null)}
          onDismiss={() => {
            hideLocally(detail.id);
            mark.mutate({ id: detail.id, body: { dismissed: true } });
            setDetail(null);
          }}
        />
      ) : null}
    </>
  );
}

export function ProjectedFundsAlertDetail({
  alert,
  onClose,
  onDismiss,
}: {
  alert: ProjectedFundsAlert;
  onClose: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-4" role="dialog">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-5 space-y-3">
        <h2 className="text-base font-semibold text-gray-900">{alert.title}</h2>
        <p className="text-sm text-gray-600">{alert.body}</p>
        <dl className="text-sm grid grid-cols-2 gap-x-3 gap-y-1">
          <dt className="text-gray-500">Account</dt>
          <dd className="text-gray-900">{alert.account_name}</dd>
          <dt className="text-gray-500">Scheduled</dt>
          <dd className="text-gray-900">{alert.payee || "Payment"}</dd>
          <dt className="text-gray-500">Date</dt>
          <dd className="text-gray-900">{alert.occurrence_date}</dd>
          <dt className="text-gray-500">Amount</dt>
          <dd className="text-gray-900">${alert.amount}</dd>
          <dt className="text-gray-500">Projected before</dt>
          <dd className="text-gray-900">${alert.projected_balance_before}</dd>
          <dt className="text-gray-500">Projected after</dt>
          <dd className="text-gray-900">${alert.projected_balance_after}</dd>
          <dt className="text-gray-500">Shortfall</dt>
          <dd className="text-gray-900">{alert.shortfall_display}</dd>
        </dl>
        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            to={projectedFundsLedgerPath(alert)}
            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
            onClick={onClose}
          >
            View in ledger
          </Link>
          <Link
            to={projectedFundsForecastPath(alert)}
            className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
            onClick={onClose}
          >
            View forecast
          </Link>
          <button type="button" className="text-xs text-gray-600 hover:underline" onClick={onDismiss}>
            Dismiss
          </button>
          <button type="button" className="ml-auto text-xs text-gray-500 hover:underline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
