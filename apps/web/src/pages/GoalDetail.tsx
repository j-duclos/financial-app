import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import { getBucketDetail, listScenarios } from "@budget-app/api-client";
import {
  formatGoalProgressLine,
  goalHealthBadgeClass,
  goalHealthLabel,
  parseProgressPercent,
} from "../lib/goalDisplay";
import { formatDateDisplay } from "../lib/dateDisplay";
import { PAGE_SHELL_PY } from "../lib/pageLayout";
import {
  goalFundingLine,
  goalProjectionLine,
  goalSuggestionLine,
  paceStatusBadgeClass,
  paceStatusLabel,
} from "../lib/goalInsights";

function GrowthChart({
  points,
  target,
}: {
  points: Array<{ label: string; amount: string }>;
  target: string;
}) {
  if (points.length === 0) return null;
  const targetNum = parseFloat(target) || 1;
  const maxVal = Math.max(targetNum, ...points.map((p) => parseFloat(p.amount) || 0));
  const w = 480;
  const h = 120;
  const pad = 8;

  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (w - pad * 2);
    const y = h - pad - ((parseFloat(p.amount) || 0) / maxVal) * (h - pad * 2);
    return { x, y, label: p.label, amount: p.amount };
  });

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");

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
        <path d={line} fill="none" stroke="currentColor" strokeWidth="2" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r="3" fill="currentColor" />
        ))}
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
  const projection = goal ? goalProjectionLine(goal) : "";
  const suggestion = goal ? goalSuggestionLine(goal) : null;
  const { source, transfer } = goal ? goalFundingLine(goal) : { source: null, transfer: null };

  const history = data?.contribution_history ?? [];
  const scenariosList = data?.forecast_scenarios ?? [];

  const paceLabel = useMemo(() => paceStatusLabel(goal?.pace_status), [goal?.pace_status]);

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

  const hasSidebar = scenarios.length > 0 || scenariosList.length > 0;
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

      {isLoading && <p className="text-sm text-gray-500">Loading goal…</p>}
      {isError && (
        <p className="text-sm text-red-600">Could not load this goal.</p>
      )}

      {goal && (
        <div className="space-y-4">
          <div
            className={`grid grid-cols-1 gap-4 ${hasSidebar ? "lg:grid-cols-3" : "lg:grid-cols-1"}`}
          >
            <header
              className={`bg-white rounded-lg border border-gray-200 p-4 sm:p-5 space-y-3 ${
                hasSidebar ? "lg:col-span-2" : ""
              }`}
            >
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
                <div
                  className="h-full rounded-full bg-blue-600"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <p className="text-base font-medium text-gray-800">{formatGoalProgressLine(goal)}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {projection ? <p className="text-gray-600">{projection}</p> : <span />}
                {suggestion ? (
                  <p className="text-blue-800 font-medium sm:text-right">{suggestion}</p>
                ) : null}
              </div>

              {goal.pace_warnings && goal.pace_warnings.length > 0 && (
                <ul className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3 space-y-0.5">
                  {goal.pace_warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}

              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
                {source && (
                  <div>
                    <dt className="text-gray-500">Funding</dt>
                    <dd className="font-medium text-gray-900">{source}</dd>
                  </div>
                )}
                {transfer && (
                  <div className="sm:col-span-2">
                    <dt className="text-gray-500">Transfers</dt>
                    <dd className="font-medium text-gray-900">{transfer}</dd>
                  </div>
                )}
                {goal.contribution_pace_monthly && (
                  <div>
                    <dt className="text-gray-500">Current pace</dt>
                    <dd className="font-medium text-gray-900">
                      {formatCurrency(goal.contribution_pace_monthly)}/mo
                    </dd>
                  </div>
                )}
                {goal.target_date && (
                  <div>
                    <dt className="text-gray-500">Target date</dt>
                    <dd className="font-medium text-gray-900">
                      {formatDateDisplay(goal.target_date)}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => navigate("/goals", { state: { editId: goal.id } })}
                  className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Edit goal
                </button>
              </div>
            </header>

            {hasSidebar && (
              <aside className="space-y-4 lg:col-span-1">
                {scenarios.length > 0 && (
                  <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-2 h-full">
                    <label className="block text-sm font-medium text-gray-700">
                      Scenario impact
                    </label>
                    <select
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
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
                    {data?.scenario_projection && (
                      <p className="text-sm text-gray-600">
                        With scenario:{" "}
                        <span className="font-medium text-gray-900">
                          {data.scenario_projection.projection_headline}
                        </span>
                      </p>
                    )}
                  </section>
                )}

                {scenariosList.length > 0 && (
                  <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
                    <h2 className="text-sm font-semibold text-gray-900">What-if scenarios</h2>
                    <ul className="space-y-2">
                      {scenariosList.map((s) => (
                        <li
                          key={s.id}
                          className="flex justify-between gap-3 text-sm border-b border-gray-100 pb-2 last:border-0"
                        >
                          <span className="text-gray-600">{s.label}</span>
                          <span className="text-gray-900 font-medium text-right shrink-0">
                            {s.headline}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </aside>
            )}
          </div>

          {(hasForecast || hasHistory) && (
            <div
              className={`grid grid-cols-1 gap-4 ${
                hasForecast && hasHistory ? "lg:grid-cols-2" : ""
              }`}
            >
              {hasForecast && (
                <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-5">
                  <h2 className="text-sm font-semibold text-gray-900 mb-3">Forecasted growth</h2>
                  <GrowthChart points={data!.forecast_growth!} target={goal.target_amount} />
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
                          <p className="font-medium text-gray-900">
                            {formatCurrency(c.amount)}
                          </p>
                          <p className="text-xs text-gray-500">
                            {c.account_name ?? "Account"} · {c.source}
                          </p>
                        </div>
                        <time className="text-gray-500 shrink-0">
                          {formatDateDisplay(c.date)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {goal.goal_health && goal.goal_health !== "no_schedule" && (
            <p className="text-xs text-gray-500">
              Schedule health:{" "}
              <span
                className={`px-1.5 py-0.5 rounded-full ${goalHealthBadgeClass(goal.goal_health)}`}
              >
                {goalHealthLabel(goal.goal_health)}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
