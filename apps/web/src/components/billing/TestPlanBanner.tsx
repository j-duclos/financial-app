import { testPlanIndicatorLabel } from "@budget-app/shared";
import { useBillingStatus } from "../../hooks/useBillingStatus";
import { isWebDevBuild } from "../../lib/planTestOverride";

export default function TestPlanBanner() {
  const { billing } = useBillingStatus({ enabled: isWebDevBuild() });
  const label = testPlanIndicatorLabel(billing, isWebDevBuild());
  if (!label) return null;
  return (
    <span
      data-testid="test-plan-indicator"
      className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
      title="Development plan override is active"
    >
      {label}
    </span>
  );
}
