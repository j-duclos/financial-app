import { formatCurrency, formatLongDate } from "@budget-app/shared";
import type {
  GuidedStrategyResult,
  GuidedTransferOccurrenceStatus,
  ScenarioComparisonResponse,
  ScenarioGuidedStrategy,
} from "@budget-app/shared";
import { FORECAST_PERIOD_OPTIONS } from "./scenarioComparisonDisplay";

export const GUIDED_PLAN_CHANGE_TITLE = "Redirect selected savings transfers to credit cards";

export const GUIDED_HYPOTHETICAL_DISCLAIMER =
  "This comparison is hypothetical. It does not change real transactions, recurring rules, forecasts, accounts, or balances.";

const TRANSFER_STATUS_LABELS: Record<GuidedTransferOccurrenceStatus, string> = {
  redirected: "Redirected to debt",
  split: "Split between debt and savings",
  resumed_savings: "Resumed savings",
  buffer_limited: "Limited by cash buffer",
  skipped: "Skipped",
};

export function guidedTransferStatusLabel(status: GuidedTransferOccurrenceStatus): string {
  return TRANSFER_STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function forecastHorizonLabel(
  horizon: ScenarioComparisonResponse["horizon"] | undefined,
  horizonMonths: number
): string {
  const match = FORECAST_PERIOD_OPTIONS.find((opt) => opt.value === horizon);
  if (match) return match.label;
  if (horizonMonths === 1) return "1 month";
  return `${horizonMonths} months`;
}

export function formatGuidedNullableDate(
  isoDate: string | null | undefined,
  fallback: string
): string {
  if (isoDate == null || String(isoDate).trim() === "") return fallback;
  return formatLongDate(isoDate) ?? fallback;
}

export function formatGuidedMoney(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  return formatCurrency(value);
}

function sameDecimal(left: string, right: string): boolean {
  return parseFloat(left) === parseFloat(right);
}

export function comparisonMatchesGuidedStrategy(
  comparison: ScenarioComparisonResponse | undefined,
  strategy: ScenarioGuidedStrategy | null
): boolean {
  if (!comparison) return true;
  const result = comparison.guided_strategy_result ?? null;
  if (!strategy) return result == null;
  if (!result) return false;
  return (
    result.source_account_id === strategy.source_account.id &&
    result.savings_account_id === strategy.savings_account.id &&
    result.start_date.slice(0, 10) === strategy.start_date.slice(0, 10) &&
    result.payoff_strategy === strategy.payoff_strategy &&
    sameDecimal(result.allocation_percent, strategy.allocation_percent) &&
    sameDecimal(result.minimum_cash_buffer, strategy.minimum_cash_buffer)
  );
}

export type GuidedComparisonViewState =
  | "hidden"
  | "loading"
  | "ready"
  | "missing_result"
  | "error";

export function guidedComparisonViewState(args: {
  strategy: ScenarioGuidedStrategy | null | undefined;
  strategyLoading: boolean;
  comparison: ScenarioComparisonResponse | undefined;
  comparisonFetching: boolean;
  comparisonError: boolean;
  comparisonBelongsToScenario: boolean;
}): GuidedComparisonViewState {
  const {
    strategy,
    strategyLoading,
    comparison,
    comparisonFetching,
    comparisonError,
    comparisonBelongsToScenario,
  } = args;
  if (!strategy && !strategyLoading) return "hidden";
  if (strategyLoading || !comparisonBelongsToScenario) return "loading";
  if (comparisonError && !comparison) return "error";
  if (!comparison || comparisonFetching || !comparisonMatchesGuidedStrategy(comparison, strategy ?? null)) {
    if (strategy && comparison && !comparisonFetching && !comparison.guided_strategy_result) {
      return "missing_result";
    }
    if (strategy && comparison && !comparisonFetching && !comparisonMatchesGuidedStrategy(comparison, strategy)) {
      return "missing_result";
    }
    return "loading";
  }
  if (!comparison.guided_strategy_result) return "missing_result";
  return "ready";
}

export function planHasHypotheticalChanges(
  manualChangeCount: number,
  guidedStrategy: ScenarioGuidedStrategy | null | undefined
): boolean {
  return manualChangeCount > 0 || guidedStrategy != null;
}

function moneyNumber(value: string | null | undefined): number {
  const n = parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export function guidedTradeoffExplanation(result: GuidedStrategyResult): string {
  const parts: string[] = [];
  parts.push(
    "Paying debt first reduces selected card debt and avoids interest within this forecast, but temporarily lowers savings."
  );
  if (moneyNumber(result.total_left_in_source_due_to_buffer) > 0) {
    parts.push("The cash buffer prevented some planned money from being redirected.");
  }
  if (result.savings_resumed_date) {
    parts.push(
      `Savings transfers resume on ${formatGuidedNullableDate(result.savings_resumed_date, "a date in this forecast")} after the selected cards are paid.`
    );
  } else if (result.debt_free_date == null) {
    parts.push("Selected cards are not fully paid within this forecast, so savings may stay reduced through the end of the period.");
  }
  if (moneyNumber(result.total_unallocated_after_payoff) > 0) {
    parts.push("After the selected cards were paid, leftover planned transfer money stayed in the source account.");
  }
  return parts.join(" ");
}

export function netPositionBreakEvenCopy(result: GuidedStrategyResult): {
  label: string;
  value: string;
} {
  return {
    label: "When savings minus selected debt catches up",
    value: formatGuidedNullableDate(
      result.net_position_break_even_date ?? result.break_even_date,
      "Not within this forecast"
    ),
  };
}

export function savingsBalanceCatchUpCopy(result: GuidedStrategyResult): {
  label: string;
  value: string;
} {
  return {
    label: "When the savings balance itself catches up",
    value: formatGuidedNullableDate(
      result.savings_balance_catch_up_date,
      "Savings do not catch up within this forecast"
    ),
  };
}

export function debtFreeDateCopy(result: GuidedStrategyResult): string {
  return formatGuidedNullableDate(
    result.debt_free_date,
    "Selected cards are not fully paid within this forecast"
  );
}

export function savingsResumedDateCopy(result: GuidedStrategyResult): string {
  return formatGuidedNullableDate(
    result.savings_resumed_date,
    "Not within this forecast"
  );
}

export function fieldErrorsFromApiMessage(message: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const parts = message.split(/\s*[;—]\s*/);
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (/^[a-z_][a-z0-9_]*$/.test(key) && value) errors[key] = value;
  }
  return errors;
}
