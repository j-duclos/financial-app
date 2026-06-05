import { useMemo } from "react";
import type { Account } from "@budget-app/shared";
import { formatCurrency, getEffectiveDisplayName } from "@budget-app/shared";
import {
  amountForPaymentPlanOption,
  buildPaymentPlannerSubtitles,
  paymentPlanOptionsForAccount,
  targetUtilizationPlanHint,
  type PaymentPlanOptionId,
} from "../../lib/paymentPlannerDisplay";

type Props = {
  card: Account;
  accounts: Account[];
  planOption: PaymentPlanOptionId;
  onPlanOptionChange: (option: PaymentPlanOptionId) => void;
};

export default function PaymentPlannerSection({
  card,
  accounts,
  planOption,
  onPlanOptionChange,
}: Props) {
  const subtitles = useMemo(
    () => buildPaymentPlannerSubtitles(card, accounts),
    [card, accounts]
  );
  const options = useMemo(() => paymentPlanOptionsForAccount(card), [card]);
  const utilHint =
    planOption === "target_utilization" ? targetUtilizationPlanHint(card) : null;

  return (
    <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
      <div>
        <p className="text-xs font-medium text-indigo-900">
          Planning for {getEffectiveDisplayName(card)}
        </p>
        {subtitles.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5">
            {subtitles.map((line) => (
              <li key={line} className="text-xs text-indigo-950 leading-snug">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-indigo-800">
            Choose a payment amount to reduce debt and interest.
          </p>
        )}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-[10px] font-semibold uppercase tracking-wide text-indigo-800">
          Payment amount
        </legend>
        {options.map((opt) => {
          const hint =
            opt.id === "target_utilization" ? targetUtilizationPlanHint(card) : null;
          const preview =
            opt.id !== "custom_amount"
              ? amountForPaymentPlanOption(card, opt.id)
              : null;
          return (
            <label
              key={opt.id}
              className={`flex cursor-pointer gap-2 rounded-md border px-2.5 py-2 text-sm transition ${
                planOption === opt.id
                  ? "border-indigo-400 bg-white shadow-sm"
                  : "border-transparent bg-white/50 hover:bg-white/80"
              }`}
            >
              <input
                type="radio"
                name="payment-plan-option"
                value={opt.id}
                checked={planOption === opt.id}
                onChange={() => onPlanOptionChange(opt.id)}
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-gray-900">{opt.label}</span>
                {hint && (
                  <span className="mt-0.5 block text-xs text-gray-600">{hint}</span>
                )}
                {!hint && preview && opt.id !== "custom_amount" && (
                  <span className="mt-0.5 block text-xs text-gray-500 tabular-nums">
                    {formatCurrency(preview)}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      {utilHint && planOption !== "target_utilization" ? (
        <p className="text-xs text-indigo-800">{utilHint}</p>
      ) : null}
    </div>
  );
}
