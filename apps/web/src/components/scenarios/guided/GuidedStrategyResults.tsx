import { useState } from "react";
import { formatLongDate } from "@budget-app/shared";
import type {
  GuidedStrategyDebtPayment,
  GuidedStrategyResult,
  ScenarioComparisonResponse,
} from "@budget-app/shared";
import {
  GUIDED_HYPOTHETICAL_DISCLAIMER,
  debtFreeDateCopy,
  forecastHorizonLabel,
  formatGuidedMoney,
  formatGuidedNullableDate,
  guidedTradeoffExplanation,
  guidedTransferStatusLabel,
  netPositionBreakEvenCopy,
  savingsBalanceCatchUpCopy,
  savingsResumedDateCopy,
} from "../../../lib/guidedStrategyDisplay";

type GuidedStrategyResultsProps = {
  comparison: ScenarioComparisonResponse | undefined;
  horizonMonths: number;
  viewState: "loading" | "ready" | "missing_result" | "error";
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-600">{label}</dt>
      <dd className="text-sm font-medium text-gray-900 tabular-nums">{value}</dd>
    </div>
  );
}

function paymentsByCard(
  payments: GuidedStrategyDebtPayment[]
): Array<{ accountId: number; rows: GuidedStrategyDebtPayment[] }> {
  const order: number[] = [];
  const grouped = new Map<number, GuidedStrategyDebtPayment[]>();
  for (const payment of payments) {
    if (!grouped.has(payment.debt_account_id)) {
      grouped.set(payment.debt_account_id, []);
      order.push(payment.debt_account_id);
    }
    grouped.get(payment.debt_account_id)?.push(payment);
  }
  return order.map((accountId) => ({ accountId, rows: grouped.get(accountId) ?? [] }));
}

export default function GuidedStrategyResults({
  comparison,
  horizonMonths,
  viewState,
}: GuidedStrategyResultsProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const horizonLabel = forecastHorizonLabel(comparison?.horizon, horizonMonths);

  if (viewState === "loading") {
    return (
      <section
        id="guided-strategy-results"
        className="mb-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-950"
      >
        <h2 className="text-lg font-semibold">Calculating this comparison</h2>
        <p className="text-sm mt-1">
          Comparing keep-saving with pay-debt-first for this {horizonLabel} forecast. This is not a
          zero-impact result.
        </p>
      </section>
    );
  }

  if (viewState === "error") {
    return (
      <section
        id="guided-strategy-results"
        className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-900"
      >
        <h2 className="text-lg font-semibold">Could not calculate this comparison</h2>
        <p className="text-sm mt-1">
          The guided strategy is still saved. Retry to see impact — this is not a zero-impact result.
        </p>
      </section>
    );
  }

  if (viewState === "missing_result") {
    return (
      <section
        id="guided-strategy-results"
        className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950"
      >
        <h2 className="text-lg font-semibold">Comparison is not ready yet</h2>
        <p className="text-sm mt-1">
          This plan has a saved Debt first vs. save first strategy, but the comparison did not
          include a result. Recalculate the plan or edit the strategy. This is not a zero-impact
          result.
        </p>
      </section>
    );
  }

  const result = comparison?.guided_strategy_result;
  if (!result) return null;

  const breakEven = netPositionBreakEvenCopy(result);
  const savingsCatchUp = savingsBalanceCatchUpCopy(result);
  const lowestBalanceDate = formatGuidedNullableDate(
    result.lowest_source_balance_date,
    "Not within this forecast"
  );

  return (
    <section
      id="guided-strategy-results"
      className="mb-6 rounded-xl border border-indigo-200 bg-white px-4 py-4"
      aria-labelledby="guided-results-title"
    >
      <h2 id="guided-results-title" className="text-lg font-semibold text-gray-900">
        Debt first vs. save first
      </h2>
      <p className="text-sm text-gray-600 mt-1">
        Results within this {horizonLabel} forecast
        {comparison?.start_date && comparison?.end_date
          ? ` (${formatLongDate(comparison.start_date) ?? comparison.start_date} – ${formatLongDate(comparison.end_date) ?? comparison.end_date})`
          : ""}
        . Not a lifetime projection.
      </p>
      <p className="text-xs text-gray-500 mt-1">{GUIDED_HYPOTHETICAL_DISCLAIMER}</p>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <article className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h3 className="text-sm font-semibold text-gray-900">Keep saving</h3>
          <p className="text-xs text-gray-600 mt-0.5">Leave selected transfers on the current path</p>
          <dl className="mt-3 space-y-2">
            <Metric
              label={`Savings at the end of this ${horizonLabel} forecast`}
              value={formatGuidedMoney(result.baseline.savings_at_horizon)}
            />
            <Metric
              label={`Selected credit-card debt at the end of this ${horizonLabel} forecast`}
              value={formatGuidedMoney(result.baseline.selected_debt_at_horizon)}
            />
          </dl>
        </article>
        <article className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
          <h3 className="text-sm font-semibold text-gray-900">Pay debt first</h3>
          <p className="text-xs text-gray-600 mt-0.5">
            Hypothetically redirect selected transfers to the selected cards
          </p>
          <dl className="mt-3 space-y-2">
            <Metric
              label={`Savings at the end of this ${horizonLabel} forecast`}
              value={formatGuidedMoney(result.debt_first.savings_at_horizon)}
            />
            <Metric
              label={`Selected credit-card debt at the end of this ${horizonLabel} forecast`}
              value={formatGuidedMoney(result.debt_first.selected_debt_at_horizon)}
            />
            <Metric
              label={`Interest avoided within this ${horizonLabel} forecast`}
              value={formatGuidedMoney(result.interest_avoided_within_horizon)}
            />
            <Metric
              label="Total redirected to debt"
              value={formatGuidedMoney(result.total_redirected_to_debt)}
            />
            <Metric label="Selected cards paid off" value={debtFreeDateCopy(result)} />
            <Metric label="Savings transfers resume" value={savingsResumedDateCopy(result)} />
            <Metric
              label="Lowest projected source-account balance"
              value={
                result.lowest_source_balance == null
                  ? "Not within this forecast"
                  : `${formatGuidedMoney(result.lowest_source_balance)} on ${lowestBalanceDate}`
              }
            />
          </dl>
        </article>
      </div>

      <dl className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-gray-200 p-3">
          <dt className="text-xs font-medium text-gray-600">{breakEven.label}</dt>
          <dd className="mt-1 font-medium text-gray-900">{breakEven.value}</dd>
        </div>
        <div className="rounded-lg border border-gray-200 p-3">
          <dt className="text-xs font-medium text-gray-600">{savingsCatchUp.label}</dt>
          <dd className="mt-1 font-medium text-gray-900">{savingsCatchUp.value}</dd>
        </div>
      </dl>

      <p className="mt-4 text-sm text-gray-800">{guidedTradeoffExplanation(result)}</p>

      <div className="mt-4 border-t border-gray-100 pt-3">
        <button
          type="button"
          className="text-sm font-medium text-indigo-800 hover:underline"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {detailsOpen ? "Hide transfer details" : "See transfer details"}
        </button>
        {detailsOpen ? <GuidedTransferDetails result={result} /> : null}
      </div>
    </section>
  );
}

function GuidedTransferDetails({ result }: { result: GuidedStrategyResult }) {
  const cardNames = new Map(result.debt_accounts.map((account) => [account.account_id, account.name]));
  const groupedPayments = paymentsByCard(result.debt_payments);

  return (
    <div className="mt-3 space-y-4">
      <div>
        <h4 className="text-sm font-medium text-gray-900 mb-2">How this works</h4>
        <p className="text-xs text-gray-600 mb-2">
          Each selected savings-transfer occurrence from the comparison. Amounts come from the
          saved result — this screen does not recalculate them.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <caption className="sr-only">Selected savings-transfer occurrences</caption>
            <thead>
              <tr className="border-b text-gray-600">
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Date
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Planned
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Affordable after buffer
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Redirected to debt
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Still sent to savings
                </th>
                <th scope="col" className="py-1.5 pr-3 font-medium">
                  Left in source
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {result.transfer_occurrences.map((row) => (
                <tr key={`${row.date}-${row.rule_id}`} className="border-b border-gray-100">
                  <td className="py-1.5 pr-3">{formatLongDate(row.date) ?? row.date}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatGuidedMoney(row.original_amount)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatGuidedMoney(row.affordable_amount)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatGuidedMoney(row.redirected_to_debt)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatGuidedMoney(row.sent_to_savings)}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{formatGuidedMoney(row.left_in_source)}</td>
                  <td className="py-1.5">{guidedTransferStatusLabel(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-900 mb-2">Debt-payment allocation by card</h4>
        {groupedPayments.length === 0 ? (
          <p className="text-sm text-gray-600">No guided debt payments were returned for this forecast.</p>
        ) : (
          <ul className="space-y-2">
            {groupedPayments.map((group) => (
              <li key={group.accountId} className="rounded-lg border border-gray-200 p-2">
                <p className="text-sm font-medium text-gray-900">
                  {cardNames.get(group.accountId) ?? `Card ${group.accountId}`}
                </p>
                <ul className="mt-1 space-y-1 text-xs text-gray-700">
                  {group.rows.map((row) => (
                    <li key={`${row.date}-${row.debt_account_id}-${row.amount}`}>
                      {formatLongDate(row.date) ?? row.date}: {formatGuidedMoney(row.amount)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-900 mb-2">Selected cards</h4>
        <ul className="space-y-2">
          {result.debt_accounts.map((account) => (
            <li key={account.account_id} className="rounded-lg border border-gray-200 p-2 text-sm">
              <p className="font-medium text-gray-900">{account.name}</p>
              <p className="text-xs text-gray-600 mt-1">
                Opening {formatGuidedMoney(account.opening_owed)} · Ending{" "}
                {formatGuidedMoney(account.ending_owed)} · Guided payments{" "}
                {formatGuidedMoney(account.guided_payments)} · Payoff{" "}
                {formatGuidedNullableDate(
                  account.payoff_date,
                  "Selected cards are not fully paid within this forecast"
                )}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
