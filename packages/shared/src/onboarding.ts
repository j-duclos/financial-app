export type OnboardingSteps = {
  account: boolean;
  transaction: boolean;
  recurring: boolean;
  forecast_ready: boolean;
};

export type OnboardingProgress = {
  completed_steps: number;
  total_steps: number;
};

/** Cheap existence flags for the Getting Started checklist. Does not affect forecast_ready. */
export type OnboardingChecklistFlags = {
  account: boolean;
  upcoming_transaction: boolean;
  recurring: boolean;
  goal: boolean;
};

export type OnboardingStatus = {
  completed: boolean;
  dismissed: boolean;
  show_welcome: boolean;
  steps: OnboardingSteps;
  progress: OnboardingProgress;
  checklist?: OnboardingChecklistFlags;
};

export const ONBOARDING_TOTAL_STEPS = 4;

export function isForecastReadyFromSetup(
  steps: Pick<OnboardingSteps, "account" | "transaction" | "recurring">
): boolean {
  return Boolean(steps.account) && (Boolean(steps.transaction) || Boolean(steps.recurring));
}

export function shouldShowOnboardingWelcome(
  status: OnboardingStatus | null | undefined
): boolean {
  return Boolean(status?.show_welcome);
}

export function shouldShowDashboardSetup(
  status: OnboardingStatus | null | undefined
): boolean {
  if (!status) return false;
  return !status.completed && !status.dismissed && !status.steps.forecast_ready;
}

/** Record existence only — a $0 balance is not “no data.” */
export function isMissingAccounts(status: OnboardingStatus | null | undefined): boolean {
  return status?.steps.account === false;
}
