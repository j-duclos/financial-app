import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import type { Scenario, RecurringRule, ScenarioRuleOverride } from "@budget-app/shared";
import {
  listScenarios,
  listRules,
  listScenarioOverrides,
  createScenario,
  createScenarioOverride,
  updateScenarioOverride,
  deleteScenarioOverride,
  listHouseholds,
  getProfile,
  getTimeline,
} from "@budget-app/api-client";

export default function Scenarios() {
  const [modalOpen, setModalOpen] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | "">("");
  const [householdId, setHouseholdId] = useState<number | "">("");
  const [compareHorizon, setCompareHorizon] = useState<"6m" | "12m" | "24m">("12m");
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const { data: households } = useQuery({ queryKey: ["households"], queryFn: listHouseholds });
  const { data: scenariosData } = useQuery({ queryKey: ["scenarios"], queryFn: () => listScenarios() });
  const { data: rulesData } = useQuery({ queryKey: ["rules"], queryFn: () => listRules() });
  const scenarios = scenariosData?.results ?? [];
  const rules = rulesData?.results ?? [];
  const defaultHousehold = profile?.default_household ?? households?.[0]?.id;

  const { data: baseTimeline } = useQuery({
    queryKey: ["timeline", "base", compareHorizon, defaultHousehold],
    queryFn: () => getTimeline({ horizon: compareHorizon, household_id: defaultHousehold || undefined }),
  });
  const { data: scenarioTimeline } = useQuery({
    queryKey: ["timeline", "scenario", selectedScenarioId, compareHorizon],
    queryFn: () => getTimeline({ horizon: compareHorizon, scenario_id: selectedScenarioId || undefined }),
    enabled: !!selectedScenarioId,
  });

  const { data: overrides } = useQuery({
    queryKey: ["scenario-overrides", selectedScenarioId],
    queryFn: () => listScenarioOverrides(selectedScenarioId as number),
    enabled: !!selectedScenarioId,
  });

  const createScenarioMu = useMutation({
    mutationFn: (data: { household: number; name: string }) => createScenario(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scenarios"] });
      setModalOpen(false);
      setNewScenarioName("");
    },
  });

  const baseEndBalances = (baseTimeline?.account_summary ?? []).reduce(
    (acc: number, a: { ending_balance: string }) => acc + parseFloat(a.ending_balance),
    0
  );
  const scenarioEndBalances = (scenarioTimeline?.account_summary ?? []).reduce(
    (acc: number, a: { ending_balance: string }) => acc + parseFloat(a.ending_balance),
    0
  );
  const delta = selectedScenarioId ? scenarioEndBalances - baseEndBalances : 0;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-semibold">Scenarios</h1>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
        >
          New scenario
        </button>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Create a scenario to override rule amounts, active state, or dates and compare projected balances.
      </p>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Select scenario</label>
          <select
            value={selectedScenarioId}
            onChange={(e) => setSelectedScenarioId(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {scenarios.map((s: Scenario) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">Compare at horizon</label>
          <select
            value={compareHorizon}
            onChange={(e) => setCompareHorizon(e.target.value as "6m" | "12m" | "24m")}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="6m">6 months</option>
            <option value="12m">12 months</option>
            <option value="24m">24 months</option>
          </select>
        </div>
      </div>

      {selectedScenarioId && (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase">Base total ({compareHorizon})</p>
              <p className="text-lg font-semibold">{formatCurrency(String(baseEndBalances), "USD")}</p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase">Scenario total ({compareHorizon})</p>
              <p className="text-lg font-semibold">{formatCurrency(String(scenarioEndBalances), "USD")}</p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase">Delta</p>
              <p className={`text-lg font-semibold ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                {delta >= 0 ? "+" : ""}{formatCurrency(String(delta), "USD")}
              </p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <h2 className="px-4 py-2 bg-gray-50 font-medium text-sm">Rule overrides for this scenario</h2>
            {overrides && (overrides as ScenarioRuleOverride[]).length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {(overrides as ScenarioRuleOverride[]).map((ov: ScenarioRuleOverride) => (
                  <li key={ov.id} className="px-4 py-2 flex justify-between items-center text-sm">
                    <span>{ov.rule?.name ?? "Rule"}</span>
                    <span className="text-gray-600">
                      {ov.override_amount != null && `Amount: ${formatCurrency(ov.override_amount, "USD")}`}
                      {ov.override_active === false && " · Inactive"}
                      {ov.override_active === true && " · Active"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-4 text-gray-500 text-sm">No overrides. Add overrides via API or a future override UI.</p>
            )}
          </div>
        </>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-medium mb-3">New scenario</h3>
            <div className="mb-3">
              <label className="block text-sm text-gray-700 mb-1">Household</label>
              <select
                value={householdId || defaultHousehold || ""}
                onChange={(e) => setHouseholdId(e.target.value === "" ? "" : Number(e.target.value))}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                {(households ?? []).map((h: { id: number; name: string }) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={newScenarioName}
                onChange={(e) => setNewScenarioName(e.target.value)}
                placeholder="e.g. No vacation"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  const hId = householdId || defaultHousehold;
                  if (hId && newScenarioName.trim()) createScenarioMu.mutate({ household: hId, name: newScenarioName.trim() });
                }}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
