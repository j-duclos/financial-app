import type { BillingPlan } from "@budget-app/shared";
import { planLabel } from "../../lib/billingDisplay";

export default function PlanBadge({
  plan,
  className = "",
}: {
  plan: BillingPlan | string;
  className?: string;
}) {
  const premium = plan === "PREMIUM";
  const label = planLabel(plan);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        premium
          ? "bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-200"
          : "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200"
      } ${className}`.trim()}
    >
      {label}
    </span>
  );
}
