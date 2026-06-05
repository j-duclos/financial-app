import { Link } from "react-router-dom";
import type { SubscriptionIntelligenceResponse } from "@budget-app/shared";
import { formatCurrency } from "@budget-app/shared";
import {
  sortSubscriptionItems,
  subscriptionConfidenceLabel,
} from "../../lib/subscriptionIntelligence";

type Props = {
  data: SubscriptionIntelligenceResponse | undefined;
  loading?: boolean;
  onSelectRule?: (ruleId: number) => void;
};

function SubscriptionRow({
  item,
  onSelectRule,
  suggested = false,
}: {
  item: SubscriptionIntelligenceResponse["subscriptions"][number];
  onSelectRule?: (ruleId: number) => void;
  suggested?: boolean;
}) {
  const hint = subscriptionConfidenceLabel(item);
  const amount = formatCurrency(item.monthly_amount);
  const inner = (
    <>
      <span className="font-medium text-gray-900 truncate">{item.name}</span>
      <span className="tabular-nums text-gray-800 shrink-0">{amount}/mo</span>
    </>
  );

  if (item.rule_id != null && onSelectRule) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onSelectRule(item.rule_id!)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-gray-50 rounded-md text-left"
        >
          {inner}
        </button>
        {hint && <p className="px-3 -mt-1 pb-1 text-xs text-gray-500">{hint}</p>}
      </li>
    );
  }

  return (
    <li className="px-3 py-2 text-sm flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-gray-900 truncate">{item.name}</span>
        <span className="tabular-nums text-gray-800 shrink-0">{amount}/mo</span>
      </div>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {suggested && (
        <p className="text-xs text-amber-700">
          Not in automation yet —{" "}
          <Link to="/automation" className="text-blue-600 hover:underline">
            add a recurring rule
          </Link>
        </p>
      )}
    </li>
  );
}

export default function SubscriptionIntelligencePanel({
  data,
  loading = false,
  onSelectRule,
}: Props) {
  if (loading) {
    return (
      <section
        className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse"
        aria-label="Subscription intelligence"
      >
        <div className="h-5 w-48 bg-gray-200 rounded mb-3" />
        <div className="h-8 w-32 bg-gray-100 rounded mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 bg-gray-50 rounded" />
          ))}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const subscriptions = sortSubscriptionItems(data.subscriptions);
  const suggested = sortSubscriptionItems(data.suggested);
  const hasAny = subscriptions.length > 0 || suggested.length > 0;

  if (!hasAny) {
    return (
      <section
        className="rounded-lg border border-dashed border-gray-300 bg-gray-50/80 p-4"
        aria-label="Subscription intelligence"
      >
        <h2 className="text-sm font-semibold text-gray-900">Subscription intelligence</h2>
        <p className="text-sm text-gray-600 mt-1">
          No subscriptions detected yet. Tag streaming, software, or gym charges in{" "}
          <Link to="/automation" className="text-blue-600 hover:underline">
            Automation
          </Link>{" "}
          or use categories like Streaming or Memberships.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-white p-4"
      aria-label="Subscription intelligence"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Subscription intelligence</h2>
          <p className="text-xs text-gray-600 mt-0.5">
            Active recurring subscriptions and detected repeating charges
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Monthly commitments
          </p>
          <p className="text-2xl font-bold text-gray-900 tabular-nums">
            {formatCurrency(data.monthly_commitments_total)}
          </p>
          {subscriptions.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">
              {subscriptions.length} subscription{subscriptions.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {subscriptions.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white/90">
          {subscriptions.map((item) => (
            <SubscriptionRow key={item.id} item={item} onSelectRule={onSelectRule} />
          ))}
        </ul>
      )}

      {suggested.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Detected from bank history
          </p>
          <ul className="divide-y divide-gray-100 rounded-md border border-amber-200/80 bg-amber-50/40">
            {suggested.map((item) => (
              <SubscriptionRow key={item.id} item={item} suggested />
            ))}
          </ul>
          {parseFloat(data.suggested_monthly_total) > 0 && (
            <p className="text-xs text-gray-600 mt-2">
              Potential add-ons: {formatCurrency(data.suggested_monthly_total)}/mo if added to your plan
            </p>
          )}
        </div>
      )}
    </section>
  );
}
