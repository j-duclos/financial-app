import { Link } from "react-router-dom";
import type { OnboardingStatus } from "@budget-app/shared";

const STEPS: {
  key: keyof OnboardingStatus["steps"];
  title: string;
  hint: string;
  to: string;
}[] = [
  {
    key: "account",
    title: "Add an account",
    hint: "Checking, savings, or a credit card you want to track.",
    to: "/accounts?new=1",
  },
  {
    key: "transaction",
    title: "Add your first transaction",
    hint: "A current or recent transaction is enough.",
    to: "/transactions",
  },
  {
    key: "recurring",
    title: "Add recurring income or bills",
    hint: "Paychecks, rent, and subscriptions make forecasts useful.",
    to: "/recurring",
  },
  {
    key: "forecast_ready",
    title: "View your forecast",
    hint: "See projected balances and upcoming cash flow.",
    to: "/",
  },
];

type Props = {
  status: OnboardingStatus;
  isPremium?: boolean;
};

export default function OnboardingChecklist({ status, isPremium = false }: Props) {
  const { progress, steps } = status;
  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5 space-y-3"
      data-testid="onboarding-checklist"
      aria-labelledby="onboarding-checklist-heading"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="onboarding-checklist-heading" className="text-base font-semibold text-gray-900">
          Build your first forecast
        </h2>
        <p className="text-sm text-gray-600" aria-live="polite">
          {progress.completed_steps} of {progress.total_steps} complete
        </p>
      </div>
      <ol className="space-y-2">
        {STEPS.map((step, index) => {
          const done = steps[step.key];
          const to =
            step.key === "account" && isPremium ? "/accounts" : step.to;
          return (
            <li key={step.key}>
              <Link
                to={to}
                className="flex gap-3 rounded-md px-2 py-2 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    done ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-700"
                  }`}
                  aria-hidden="true"
                >
                  {done ? "✓" : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    {step.title}
                    <span className="sr-only">{done ? "complete" : "not complete"}</span>
                    {!done ? (
                      <span className="text-xs font-normal text-gray-500" aria-hidden="true">
                        Incomplete
                      </span>
                    ) : (
                      <span className="text-xs font-normal text-emerald-700" aria-hidden="true">
                        Complete
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-gray-600">{step.hint}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
