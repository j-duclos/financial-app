import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import { getBucketDetail, listScenarios } from "@budget-app/api-client";
import { parseProgressPercent } from "../lib/goalDisplay";
import { formatDateDisplay } from "../lib/dateDisplay";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import { whatIfGoalPath } from "../lib/whatIfContext";
import PlanningSubnav from "../components/PlanningSubnav";
import {
  goalDetailFunding,
  goalDetailProgressLine,
  goalForecastSummary,
  paceStatusBadgeClass,
  paceStatusLabel,
} from "../lib/goalInsights";

function GrowthChart({
  points,
  target,
  targetDate,
}: {
  points: Array<{ month: string; label: string; amount: string }>;
  target: string;
  targetDate: string | null;
}) {
  if (points.length === 0) return null;
  const targetNum = parseFloat(target) || 1;
  const maxVal = Math.max(targetNum, ...points.map((p) => parseFloat(p.amount) || 0));
  const w = 480;
  const h = 120;
  const pad = 8;
  const showDots = points.length <= 18;

  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((parseFloat(p.amount) || 0) / maxVal) * (h - pad * 2);
    return { x, y, label: p.label, amount: p.amount, month: p.month };
  });

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const targetMonth = targetDate?.slice(0, 7) ?? "";
  const targetCoord = targetMonth ? coords.find((c) => c.month === targetMonth) : undefined;

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto text-blue-600" aria-hidden>
        <line
          x1={pad}
          y1={h - pad - (targetNum / maxVal) * (h - pad * 2)}
          x2={w - pad}
          y2={h - pad - (targetNum / maxVal) * (h - pad * 2)}
          stroke="#d1d5db"
          strokeDasharray="4 4"
        />
        {targetCoord ? (
          <line
            x1={targetCoord.x}
            y1={pad}
            x2={targetCoord.x}
            y2={h - pad}
            stroke="#f59e0b"
            strokeDasharray="3 3"
          />
        ) : null}
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" />
        {showDots
          ? coords.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r="3" fill="currentColor" />)
          : null}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export default function GoalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goalId = Number(id);
  const [scenarioId, setScenarioId] = useState<number | "">("");

  const { data: scenariosPage } = useQuery({
    queryKey: ["scenarios"],
    queryFn: () => listScenarios(),
  });
  const scenarios = scenariosPage?.results ?? [];

  const { data, isLoading, isError } = useQuery({
    queryKey: ["bucket-detail", goalId, scenarioId],
    queryFn: () =>
      getBucketDetail(goalId, {
        scenario: scenarioId === "" ? undefined : Number(scenarioId),
      }),
    enabled: Number.isFinite(goalId) && goalId > 0,
  });

  const goal = data?.goal;
  const pct = goal ? parseProgressPercent(goal.progress_percent) : 0;
  const summary = goal ? goalForecastSummary(goal) : [];
  const { account: fundingAccount, automatic: automaticFunding } = goal
    ? goalDetailFunding(goal)
    : { account: null, automatic: null };

  const history = data?.contribution_history ?? [];
  const paceLabel = paceStatusLabel(goal?.pace_status);

  if (!Number.isFinite(goalId)) {
    return (
      <div className={`${PAGE_SHELL_PY} space-y-4`}>
        <button
          type="button"
          onClick={() => navigate("/goals")}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          ← Back to goals
        </button>
        <p className="text-sm text-gray-600">Invalid goal.</p>
      </div>
    );
  }

  const hasForecast = (data?.forecast_growth?.length ?? 0) > 1;
  const hasHistory = history.length > 0;

  return (
    <div className={`${PAGE_SHELL_PY} space-y-4`}>
      <button
        type="button"
        onClick={() => navigate("/goals")}
        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        ← Back to goals
      </button>
      <PlanningSubnav />

      {isLoading && <p className="text-sm text-gray-500">Loading goal…</p>}
      {isError && <p className="text-sm text-red-600">Could not load this goal.</p>}

      {goal && (
        <div className="space-y-4">
          <header className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">{goal.name}</h1>
                  {paceLabel ? (
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${paceStatusBadgeClass(goal.pace_status)}`}
                    >
                      {paceLabel}
                    </span>
                  ) : null}
                </div>

                <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                </div>

                <p className="text-base font-medium text-gray-800">{goalDetailProgressLine(goal)}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              {scenarios.length > 0 ? (
                <label className="flex flex-col gap-1 text-sm min-w-[12rem]">
                  <span className="text-xs text-gray-500">Scenario</span>
                  <select
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
                    value={scenarioId}
                    onChange={(e) =>
                      setScenarioId(e.target.value === "" ? "" : Number(e.target.value))
                    }
                  >
                    <option value="">Current plan (no scenario)</option>
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => navigate(`/goals?edit=${goal.id}`)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Edit goal
                </button>
                <Link
                  to={whatIfGoalPath(goal.id)}
                  className="px-4 py-2 text-sm font-medium text-blue-700 border border-blue-200 rounded-md hover:bg-blue-50"
                >
                  Try in What-If
                </Link>
              </div>
            </div>

            {summary.length > 0 ? (
              <dl className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-x-6 gap-y-3">
                {summary.map((row) => (
                  <div key={row.label}>
                    <dt className="text-xs text-gray-500">{row.label}</dt>
                    <dd
                      className={
                        row.tone === "shortfall"
                          ? "text-sm font-medium text-amber-800"
                          : row.tone === "surplus"
                            ? "text-sm font-medium text-emerald-800"
                            : "text-sm font-medium text-gray-900"
                      }
                    >
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {(fundingAccount || automaticFunding) && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-gray-100 pt-3">
                {fundingAccount ? (
                  <div>
                    <dt className="text-xs text-gray-500">Funding account</dt>
                    <dd className="font-medium text-gray-900">{fundingAccount}</dd>
                  </div>
                ) : null}
                {automaticFunding ? (
                  <div>
                    <dt className="text-xs text-gray-500">Automatic funding</dt>
                    <dd className="font-medium text-gray-900">{automaticFunding}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </header>

          {(hasForecast || hasHistory) && (
            <div
              className={`grid grid-cols-1 gap-4 ${
                hasForecast && hasHistory ? "lg:grid-cols-2" : ""
              }`}
            >
              {hasForecast && (
                <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
                  <h2 className="text-sm font-semibold text-gray-900 mb-3">Forecasted growth</h2>
                  <GrowthChart
                    points={data!.forecast_growth!}
                    target={goal.target_amount}
                    targetDate={goal.target_date}
                  />
                </section>
              )}

              {hasHistory && (
                <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
                  <h2 className="text-sm font-semibold text-gray-900 mb-3">
                    Contribution history
                  </h2>
                  <ul className="divide-y divide-gray-100 max-h-64 lg:max-h-80 overflow-y-auto">
                    {history.map((c) => (
                      <li key={c.id} className="flex justify-between gap-3 py-2 text-sm">
                        <div>
                          <p className="font-medium text-gray-900">{formatCurrency(c.amount)}</p>
                          <p className="text-xs text-gray-500">
                            {c.account_name ?? "Account"} · {c.source}
                          </p>
                        </div>
                        <time className="text-gray-500 shrink-0">{formatDateDisplay(c.date)}</time>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
