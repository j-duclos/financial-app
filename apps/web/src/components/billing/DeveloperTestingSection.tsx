import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setTestPlanOverride } from "@budget-app/api-client";
import {
  canShowPlanTestControls,
  choiceToTestPlanOverride,
  effectivePlanLabel,
  simulatedPlanChoice,
  type SimulatedPlanChoice,
} from "@budget-app/shared";
import { useBillingStatus } from "../../hooks/useBillingStatus";
import { invalidateAfterTestPlanChange, isWebDevBuild } from "../../lib/planTestOverride";

const CHOICES: { id: SimulatedPlanChoice; label: string }[] = [
  { id: "real", label: "Real billing" },
  { id: "FREE", label: "Free" },
  { id: "PREMIUM", label: "Premium" },
];

export default function DeveloperTestingSection() {
  const queryClient = useQueryClient();
  const { billing } = useBillingStatus();
  const selected = simulatedPlanChoice(billing);
  const save = useMutation({
    mutationFn: (choice: SimulatedPlanChoice) =>
      setTestPlanOverride(choiceToTestPlanOverride(choice)),
    onSuccess: async () => {
      invalidateAfterTestPlanChange(queryClient);
    },
  });

  if (!canShowPlanTestControls(billing, isWebDevBuild())) {
    return null;
  }

  const effective = effectivePlanLabel(billing);

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-4"
      data-testid="developer-testing"
    >
      <div>
        <h2 className="text-lg font-medium text-gray-900">Developer Testing</h2>
        <p className="text-sm text-gray-600 mt-1">
          Simulate Free or Premium locally. Does not create Stripe customers, Checkout sessions, or
          subscriptions.
        </p>
      </div>
      <fieldset className="space-y-2">
        <legend className="block text-sm font-medium text-gray-700">Simulated plan</legend>
        {CHOICES.map((choice) => (
          <label key={choice.id} className="flex items-center gap-2 text-sm text-gray-800">
            <input
              type="radio"
              name="simulated-plan"
              value={choice.id}
              checked={selected === choice.id}
              disabled={save.isPending}
              onChange={() => save.mutate(choice.id)}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-gray-600" data-testid="developer-testing-effective-plan">
        Effective plan: {effective === "PREMIUM" ? "Premium" : "Free"}
      </p>
      {save.isError ? (
        <p className="text-sm text-red-600" role="status">
          Could not update the simulated plan.
        </p>
      ) : null}
    </section>
  );
}
