import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@budget-app/shared";
import { formatDateDisplay } from "../../lib/dateDisplay";
import type { Account, TimelineCalendarDay } from "@budget-app/shared";
import { simulateTransferImpact } from "@budget-app/api-client";
import { ArrowRightLeft, Sparkles } from "lucide-react";
import {
  pickDefaultSourceAccount,
  resolveImpactedAccountId,
  simulationStatusClass,
  simulationStatusLabel,
  suggestTransferAmount,
  transferSourceAccounts,
} from "../../lib/transferSimulation";
import type { TimelineHorizon } from "../../lib/timelineCalendarUtils";

type Props = {
  day: TimelineCalendarDay;
  accounts: Account[];
  horizon: TimelineHorizon;
  householdId?: number;
  scenarioId?: number | null;
  onCreateTransfer: (preset: {
    transferFromAccountId: number;
    transferToAccountId: number;
    defaultAmount: string;
    defaultDate: string;
  }) => void;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export default function TransferSimulationPanel({
  day,
  accounts,
  horizon,
  householdId,
  scenarioId,
  onCreateTransfer,
}: Props) {
  const sources = useMemo(() => transferSourceAccounts(accounts), [accounts]);
  const toAccountId = resolveImpactedAccountId(day, accounts);
  const toAccount = accounts.find((a) => a.id === toAccountId);

  const [fromAccountId, setFromAccountId] = useState<number | "">(() =>
    toAccountId != null ? pickDefaultSourceAccount(sources, toAccountId) : ""
  );
  const [amount, setAmount] = useState(() => suggestTransferAmount(day, toAccount));
  const [transferDate, setTransferDate] = useState(() =>
    day.date >= todayIso() ? day.date : todayIso()
  );

  useEffect(() => {
    if (toAccountId != null) {
      setFromAccountId(pickDefaultSourceAccount(sources, toAccountId));
      setAmount(suggestTransferAmount(day, toAccount));
      setTransferDate(day.date >= todayIso() ? day.date : todayIso());
    }
  }, [day.date, toAccountId, sources, day, toAccount]);

  const debouncedFrom = useDebouncedValue(fromAccountId, 450);
  const debouncedAmount = useDebouncedValue(amount, 450);
  const debouncedTransferDate = useDebouncedValue(transferDate, 450);

  const canSimulate =
    debouncedFrom !== "" &&
    toAccountId != null &&
    debouncedFrom !== toAccountId &&
    debouncedAmount.trim() !== "" &&
    parseFloat(debouncedAmount) > 0;

  const simulationQuery = useQuery({
    queryKey: [
      "transfer-simulation",
      debouncedFrom,
      toAccountId,
      debouncedAmount,
      debouncedTransferDate,
      day.date,
      horizon,
      householdId,
      scenarioId,
    ],
    queryFn: () =>
      simulateTransferImpact({
        from_account_id: Number(debouncedFrom),
        to_account_id: toAccountId!,
        amount: debouncedAmount,
        transfer_date: debouncedTransferDate,
        focus_date: day.date,
        horizon,
        household_id: householdId,
        scenario_id: scenarioId ?? undefined,
      }),
    enabled: canSimulate,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const result = simulationQuery.data;
  const loading = simulationQuery.isFetching && !result;
  const showRefetching = simulationQuery.isFetching && Boolean(result);

  if (toAccountId == null || sources.length === 0) {
    return (
      <section className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        <p className="font-medium text-gray-900">What if I move money?</p>
        <p className="text-xs mt-1">Add a savings or checking account to run transfer simulations.</p>
      </section>
    );
  }

  const minDate = todayIso();

  return (
    <section
      className="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50/90 to-white px-3 py-3 space-y-3 shadow-sm"
      aria-label="What if I move money?"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" aria-hidden />
        <h3 className="text-sm font-semibold text-gray-900">What if I move money?</h3>
        {showRefetching ? (
          <span className="text-[10px] text-indigo-600 ml-auto animate-pulse">Updating…</span>
        ) : null}
      </div>

      <div className="grid gap-2 text-sm">
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Move from</span>
          <select
            value={fromAccountId}
            onChange={(e) =>
              setFromAccountId(e.target.value === "" ? "" : Number(e.target.value))
            }
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm bg-white"
          >
            <option value="">Select account</option>
            {sources
              .filter((a) => a.id !== toAccountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>

        <div>
          <span className="text-xs font-medium text-gray-600">To</span>
          <p className="mt-0.5 font-medium text-gray-900">{toAccount?.name ?? "Impacted account"}</p>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-gray-600">Amount</span>
          <div className="mt-0.5 relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-md border border-gray-300 pl-6 pr-2 py-1.5 text-sm tabular-nums"
            />
          </div>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-600">Move date</span>
          <input
            type="date"
            min={minDate}
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
            className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div
        className={`rounded-md border px-3 py-2 text-sm transition-colors duration-300 ${
          result ? simulationStatusClass(result.result_status) : "border-gray-200 bg-white"
        }`}
        aria-live="polite"
      >
        {simulationQuery.isError ? (
          <p className="text-xs text-red-700">
            {(simulationQuery.error as Error).message || "Simulation failed."}
          </p>
        ) : loading ? (
          <p className="text-gray-500 text-xs animate-pulse">Running projection…</p>
        ) : result ? (
          <div className="space-y-2">
            <div className="flex justify-between gap-2 items-baseline">
              <span className="text-xs font-medium opacity-80">New projected low</span>
              <span className="font-semibold tabular-nums">
                {result.simulated_lowest_projected_balance != null
                  ? formatCurrency(result.simulated_lowest_projected_balance, "USD")
                  : "—"}
              </span>
            </div>
            {result.base_lowest_projected_balance != null &&
              result.simulated_lowest_projected_balance != null && (
                <p className="text-[10px] opacity-80">
                  Was{" "}
                  {formatCurrency(result.base_lowest_projected_balance, "USD")} on this day
                </p>
              )}
            <p className="font-semibold">{simulationStatusLabel(result.result_status)}</p>
            {result.recovery_date && (
              <p className="text-xs opacity-90">
                Recovered by {formatDateDisplay(result.recovery_date)}
                {result.recovery_days_until != null
                  ? ` (${result.recovery_days_until} day${result.recovery_days_until === 1 ? "" : "s"})`
                  : null}
              </p>
            )}
            {result.safe_to_spend_after != null && (
              <p className="text-xs">
                Safe-to-spend (household):{" "}
                <span className="font-medium tabular-nums">
                  {formatCurrency(result.safe_to_spend_after, "USD")}
                </span>
              </p>
            )}
            {result.source_buffer_warning && (
              <p className="text-xs font-medium text-red-800 bg-red-100/60 rounded px-2 py-1">
                Transfer may push {result.source_account_name} below its safe buffer (
                {formatCurrency(result.source_minimum_buffer, "USD")}).
                {result.source_lowest_projected_balance != null && (
                  <>
                    {" "}
                    Projected low:{" "}
                    {formatCurrency(result.source_lowest_projected_balance, "USD")}
                  </>
                )}
              </p>
            )}
            {!result.source_buffer_warning && result.source_account_name && (
              <p className="text-xs opacity-80">
                {result.source_account_name} stays above buffer in this projection.
              </p>
            )}
            {result.recovery_insight && (
              <p className="text-xs border-t border-current/10 pt-2 opacity-90">
                {result.recovery_insight}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500">Adjust fields to preview impact.</p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canSimulate || simulationQuery.isFetching}
          onClick={() => simulationQuery.refetch()}
          className="text-xs px-3 py-1.5 rounded-md border border-indigo-300 bg-white text-indigo-800 font-medium hover:bg-indigo-50 disabled:opacity-50"
        >
          {simulationQuery.isFetching ? "Simulating…" : "Simulate"}
        </button>
        <button
          type="button"
          disabled={fromAccountId === "" || !amount.trim()}
          onClick={() => {
            if (fromAccountId === "" || toAccountId == null) return;
            onCreateTransfer({
              transferFromAccountId: Number(fromAccountId),
              transferToAccountId: toAccountId,
              defaultAmount: amount,
              defaultDate: transferDate,
            });
          }}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
          Create transfer
        </button>
      </div>
    </section>
  );
}
