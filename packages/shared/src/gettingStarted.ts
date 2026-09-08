import type { OnboardingStatus } from "./onboarding";

/** Progressive first-run checklist — derived from real data, not stored progress. */
export const GETTING_STARTED_COPY = {
  welcomeTitle: "Welcome to FlowSight",
  welcomeBody: "See where your money is headed before the bills hit.",
  welcomeSecondary:
    "FlowSight projects your future balance using your accounts, upcoming transactions, and recurring income and bills.",
  welcomeCta: "Get started",
  welcomeSkip: "Skip for now",
  checklistTitle: "Getting started with FlowSight",
  checklistIntro:
    "FlowSight focuses on what happens next, not just what you already spent. Add upcoming income, bills, and planned transactions to see your future balance.",
  collapseLabel: "Hide checklist",
  expandLabel: "Show checklist",
  firstAccountTitle: "Your forecast has started",
  firstAccountBody:
    "Your starting balance is now the baseline for FlowSight. Add upcoming income and expenses to see how your balance changes over time.",
  firstAccountCta: "Add upcoming transaction",
  firstAccountSecondary: "Not now",
  firstTransactionTitle: "This is your forecast",
  firstTransactionBody:
    "FlowSight projects your balance forward using the transactions and recurring items you add.",
  firstTransactionCta: "View calendar",
  firstTransactionSecondary: "Continue",
  calendarIntro:
    "The calendar shows when money is expected to move and how those transactions affect your projected balance.",
  calendarIntroCta: "Got it",
  recurringEmpty:
    "Add paychecks, rent, subscriptions, bills, or transfers once and FlowSight will project them automatically.",
  help: {
    lowestForecastBalance:
      "The lowest this account is expected to reach during your selected forecast window.",
    availableCash: "What is currently available across your checking and savings accounts.",
    attentionRequired:
      "FlowSight watches upcoming transactions and warns you when your projected balance may be too low.",
    upcomingMoneyFlow: "Income, bills, and transfers expected soon.",
    goalsProgress: "Track progress toward savings and debt goals.",
  },
} as const;

export type GettingStartedHelpTopic = keyof typeof GETTING_STARTED_COPY.help;

export const GETTING_STARTED_HELP_LABELS: Record<GettingStartedHelpTopic, string> = {
  lowestForecastBalance: "About Lowest Forecast Balance",
  availableCash: "About Available Cash",
  attentionRequired: "About Attention Required",
  upcomingMoneyFlow: "About Upcoming money flow",
  goalsProgress: "About Goals Progress",
};

export const GETTING_STARTED_STEPS = [
  { id: "account", title: "Create your first account" },
  { id: "upcoming_transaction", title: "Add an upcoming transaction" },
  { id: "recurring", title: "Add a recurring bill or income" },
  { id: "calendar", title: "View your forecast calendar" },
  { id: "goal", title: "Create a goal" },
] as const;

export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number]["id"];

export type GettingStartedCompletion = Record<GettingStartedStepId, boolean>;

export const GETTING_STARTED_STEP_COUNT = GETTING_STARTED_STEPS.length;
export const GETTING_STARTED_COLLAPSE_THRESHOLD = 4;

export type GettingStartedEducationFlags = {
  home_forecast_intro_seen: boolean;
  first_account_success_seen: boolean;
  first_transaction_forecast_seen: boolean;
  calendar_intro_seen: boolean;
  getting_started_collapsed: boolean;
};

export const EMPTY_GETTING_STARTED_EDUCATION: GettingStartedEducationFlags = {
  home_forecast_intro_seen: false,
  first_account_success_seen: false,
  first_transaction_forecast_seen: false,
  calendar_intro_seen: false,
  getting_started_collapsed: false,
};

export function emptyGettingStartedCompletion(): GettingStartedCompletion {
  return {
    account: false,
    upcoming_transaction: false,
    recurring: false,
    calendar: false,
    goal: false,
  };
}

export function completionFromOnboardingStatus(
  status: OnboardingStatus | null | undefined,
  local: { calendarOpened: boolean }
): GettingStartedCompletion {
  const checklist = status?.checklist;
  return {
    account: checklist?.account ?? status?.steps.account === true,
    upcoming_transaction:
      checklist?.upcoming_transaction ?? status?.steps.transaction === true,
    recurring: checklist?.recurring ?? status?.steps.recurring === true,
    calendar: local.calendarOpened,
    goal: checklist?.goal === true,
  };
}

export function gettingStartedCompletedCount(completion: GettingStartedCompletion): number {
  return GETTING_STARTED_STEPS.reduce((count, step) => count + (completion[step.id] ? 1 : 0), 0);
}

export function isGettingStartedComplete(completion: GettingStartedCompletion): boolean {
  return gettingStartedCompletedCount(completion) === GETTING_STARTED_STEP_COUNT;
}

export function canCollapseGettingStarted(completion: GettingStartedCompletion): boolean {
  return gettingStartedCompletedCount(completion) >= GETTING_STARTED_COLLAPSE_THRESHOLD;
}

/**
 * Checklist stays visible while setup is incomplete.
 * Collapse is honored only after meaningful progress (4 of 5).
 * Hiding is ignored when almost nothing is done so users cannot get stuck.
 */
export function shouldShowGettingStartedCard(opts: {
  completion: GettingStartedCompletion;
  collapsed: boolean;
}): boolean {
  if (isGettingStartedComplete(opts.completion)) return false;
  if (opts.collapsed && canCollapseGettingStarted(opts.completion)) return false;
  return true;
}

export function shouldShowWelcomeOnce(opts: {
  showWelcome: boolean;
  homeForecastIntroSeen: boolean;
}): boolean {
  return opts.showWelcome && !opts.homeForecastIntroSeen;
}

export function shouldShowFirstAccountSuccess(opts: {
  hasAccount: boolean;
  firstAccountSuccessSeen: boolean;
}): boolean {
  return opts.hasAccount && !opts.firstAccountSuccessSeen;
}

export function shouldShowFirstTransactionForecast(opts: {
  hasUpcomingTransaction: boolean;
  firstTransactionForecastSeen: boolean;
}): boolean {
  return opts.hasUpcomingTransaction && !opts.firstTransactionForecastSeen;
}

export function shouldShowCalendarIntro(opts: {
  calendarIntroSeen: boolean;
}): boolean {
  return !opts.calendarIntroSeen;
}

/**
 * First persist for a user who already has a working forecast: mark one-time
 * prompts seen so existing accounts are not nagged. Brand-new users keep zeros.
 */
export function seedGettingStartedEducation(opts: {
  stored: GettingStartedEducationFlags | null;
  completion: GettingStartedCompletion;
  forecastReady?: boolean;
}): GettingStartedEducationFlags {
  if (opts.stored) return opts.stored;
  const established =
    opts.forecastReady === true ||
    (opts.completion.account &&
      (opts.completion.upcoming_transaction || opts.completion.recurring));
  if (!established) return { ...EMPTY_GETTING_STARTED_EDUCATION };
  const seededCompletion = {
    ...opts.completion,
    calendar: true,
  };
  return {
    home_forecast_intro_seen: true,
    first_account_success_seen: opts.completion.account,
    first_transaction_forecast_seen: opts.completion.upcoming_transaction,
    calendar_intro_seen: true,
    getting_started_collapsed: canCollapseGettingStarted(seededCompletion),
  };
}

export function homeEducationPriority(opts: {
  showWelcome: boolean;
  showFirstAccount: boolean;
  showFirstTransaction: boolean;
}): "welcome" | "first_account" | "first_transaction" | null {
  if (opts.showWelcome) return "welcome";
  if (opts.showFirstAccount) return "first_account";
  if (opts.showFirstTransaction) return "first_transaction";
  return null;
}
