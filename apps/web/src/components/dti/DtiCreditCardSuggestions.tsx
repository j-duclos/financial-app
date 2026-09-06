import { useState } from "react";
import { formatCurrency } from "@budget-app/shared";
import type { DtiCreditCardSuggestion } from "@budget-app/shared";
import { isPositiveBalanceSuggestion } from "../../lib/dtiProposedHome";

type Props = {
  suggestions: DtiCreditCardSuggestion[];
  loadError?: boolean;
  onRetry?: () => void;
  onAdd: (suggestion: DtiCreditCardSuggestion) => void;
};

export default function DtiCreditCardSuggestions({
  suggestions,
  loadError,
  onRetry,
  onAdd,
}: Props) {
  const [open, setOpen] = useState(false);
  const active = suggestions.filter((card) => isPositiveBalanceSuggestion(card.current_balance));

  if (loadError) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
        <h2 className="text-sm font-semibold text-gray-900">Credit cards not yet included</h2>
        <p className="text-sm text-red-700">Could not load credit-card suggestions.</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
          >
            Retry
          </button>
        ) : null}
      </section>
    );
  }

  if (active.length === 0) return null;
  const heading =
    active.length === 1
      ? "1 credit card is not included in DTI"
      : `${active.length} credit cards are not included in DTI`;

  return (
    <section
      className="rounded-lg border border-blue-200 bg-blue-50/50"
      data-testid="dti-credit-card-suggestions"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left min-h-[44px]"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="text-sm font-semibold text-gray-900">{heading}</span>
        <span className="text-xs text-gray-600">{open ? "Hide" : "Show"}</span>
      </button>
      {open ? (
        <ul className="space-y-2 border-t border-blue-100 px-3 py-2">
          {active.map((card) => (
            <li
              key={card.account_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white border border-blue-100 px-3 py-2"
            >
              <div>
                <p className="font-medium text-gray-900">{card.effective_display_name}</p>
                <p className="text-sm text-gray-600">
                  Balance {formatCurrency(card.current_balance)} · Minimum{" "}
                  {card.minimum_payment_amount
                    ? formatCurrency(card.minimum_payment_amount)
                    : "Not available"}
                  {card.minimum_payment_usable ? "" : " · minimum not usable"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onAdd(card)}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 min-h-[44px]"
              >
                Add to DTI
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
