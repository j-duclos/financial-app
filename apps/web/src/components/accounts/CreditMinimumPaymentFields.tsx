import type { Account } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import { freshnessLabel, formatMinimumPaymentSourceLine, providerDiffersFromManual } from "../../lib/minimumPaymentDisplay";

export function CreditMinimumPaymentFields({
  account,
  mode,
  manualAmount,
  onModeChange,
  onManualAmountChange,
  onRefresh,
  refreshing = false,
  refreshError = null,
}: {
  account: Account | null;
  mode: "automatic" | "manual";
  manualAmount: string;
  onModeChange: (mode: "automatic" | "manual") => void;
  onManualAmountChange: (value: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshError?: string | null;
}) {
  const canRefresh = Boolean(account?.plaid_item_id) && mode === "automatic";
  const effective = account?.effective_minimum_payment_amount ?? account?.minimum_payment_amount;
  const provider = account?.provider_minimum_payment_amount;
  const showDiff = account ? providerDiffersFromManual(account) : false;

  return (
    <fieldset className="space-y-3">
      <legend className="block text-sm font-medium text-gray-700">Minimum payment</legend>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name="minimum_payment_mode"
            value="automatic"
            checked={mode === "automatic"}
            onChange={() => onModeChange("automatic")}
          />
          Automatically sync from institution
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="radio"
            name="minimum_payment_mode"
            value="manual"
            checked={mode === "manual"}
            onChange={() => onModeChange("manual")}
          />
          Enter manually
        </label>
      </div>

      {mode === "automatic" ? (
        <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
          <p>{account ? formatMinimumPaymentSourceLine(account) : "No provider value yet."}</p>
          {effective != null ? <p>Current effective minimum: {formatCurrency(effective)}</p> : null}
          {provider != null ? <p>Last provider minimum: {formatCurrency(provider)}</p> : null}
          {account?.provider_minimum_payment_statement_date ? (
            <p>Statement date: {account.provider_minimum_payment_statement_date}</p>
          ) : null}
          {account?.provider_minimum_payment_due_date ? (
            <p>Due date: {account.provider_minimum_payment_due_date}</p>
          ) : null}
          {account?.provider_minimum_payment_observed_at ? (
            <p>Last refreshed: {account.provider_minimum_payment_observed_at}</p>
          ) : null}
          <p>Status: {freshnessLabel(account?.minimum_payment_freshness)}</p>
          {account?.manual_minimum_payment_amount ? (
            <p>Manual fallback: {formatCurrency(account.manual_minimum_payment_amount)}</p>
          ) : null}
          {account?.minimum_payment_warning ? (
            <p className="text-amber-800">{account.minimum_payment_warning}</p>
          ) : null}
          {canRefresh ? (
            <button
              type="button"
              className="mt-2 rounded border border-gray-300 bg-white px-3 py-1 text-sm"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh from institution"}
            </button>
          ) : null}
          {refreshError ? <p className="text-red-700">{refreshError}</p> : null}
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700" htmlFor="manual_minimum_payment_amount">
            Manual minimum payment
          </label>
          <input
            id="manual_minimum_payment_amount"
            type="number"
            step="0.01"
            min="0"
            value={manualAmount}
            onChange={(e) => onManualAmountChange(e.target.value)}
            className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
          />
          <p className="text-xs text-gray-500">
            Automatic updates will not replace this manual value.
          </p>
          {provider != null ? (
            <p className="text-xs text-gray-600">
              Last institution value: {formatCurrency(provider)}
              {showDiff ? " — differs from the manual minimum." : ""}
            </p>
          ) : null}
          {account ? (
            <p className="text-xs text-gray-600">{formatMinimumPaymentSourceLine(account)}</p>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}
