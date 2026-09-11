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
    "FlowSight focuses on what happens next. Add a future transaction and recurring income or bills so you can see where your balance is headed.",
  collapseLabel: "Hide checklist",
  expandLabel: "Show checklist",
  firstAccountTitle: "Your forecast has started",
  firstAccountBody:
    "Your starting balance is now the baseline for FlowSight. Add something that hasn't happened yet so FlowSight can show how it will affect your future balance.",
  firstAccountCta: "Add a future transaction",
  firstAccountSecondary: "Not now",
  firstTransactionTitle: "This is your forecast",
  firstTransactionBody:
    "FlowSight now includes that future transaction when projecting your balance. Add recurring income and bills next so your forecast can keep itself up to date.",
  firstTransactionCta: "Add recurring income or bill",
  firstTransactionSecondary: "View forecast calendar",
  calendarIntro:
    "The calendar shows when your future transactions and recurring activity are expected to happen and how they affect your projected balance.",
  calendarIntroCta: "Got it",
  calendarCompleteTitle: "You're ready",
  calendarCompleteBody:
    "FlowSight will now help you see where your balances are headed before money moves.",
  calendarCompletePrimary: "Go to Home",
  calendarCompleteSecondary: "Explore FlowSight",
  futureTransactionFormTitle: "Add something coming up",
  futureTransactionFormBody:
    "Add a bill, paycheck, purchase, transfer, or card payment that will happen in the future. FlowSight will use it to project your balance before it happens.",
  futureTransactionStepHelp:
    "Add something that hasn't happened yet so FlowSight can show how it will affect your future balance.",
  futureTransactionSavedNotFuture:
    "Transaction saved. Add one dated in the future to see how FlowSight forecasts your balance.",
  recurringOnboardingHelp:
    "Add something that repeats, such as a paycheck, rent, utilities, subscriptions, or transfers. FlowSight will automatically place future occurrences into your forecast.",
  optionalGoalsHint: "Want to plan for something specific? Create a savings or debt goal.",
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
  { id: "upcoming_transaction", title: "Add a future transaction" },
  { id: "recurring", title: "Add recurring income or a bill" },
  { id: "calendar", title: "View your forecast calendar" },
] as const;

export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number]["id"];

export type GettingStartedCompletion = Record<GettingStartedStepId, boolean>;

export const GETTING_STARTED_STEP_COUNT = GETTING_STARTED_STEPS.length;
export const GETTING_STARTED_COLLAPSE_THRESHOLD = 3;

/** Manual sources that can complete the future-transaction onboarding step. */
export const ONBOARDING_MANUAL_TRANSACTION_SOURCES = ["ACTUAL", "ONE_TIME"] as const;

export type GettingStartedEducationFlags = {
  home_forecast_intro_seen: boolean;
  first_account_success_seen: boolean;
  first_transaction_forecast_seen: boolean;
  calendar_intro_seen: boolean;
  calendar_onboarding_handoff_seen: boolean;
  getting_started_collapsed: boolean;
};

export const EMPTY_GETTING_STARTED_EDUCATION: GettingStartedEducationFlags = {
  home_forecast_intro_seen: false,
  first_account_success_seen: false,
  first_transaction_forecast_seen: false,
  calendar_intro_seen: false,
  calendar_onboarding_handoff_seen: false,
  getting_started_collapsed: false,
};

export function emptyGettingStartedCompletion(): GettingStartedCompletion {
  return {
    account: false,
    upcoming_transaction: false,
    recurring: false,
    calendar: false,
  };
}

/** Date must be after today's local ISO date (YYYY-MM-DD). Today and past do not qualify. */
export function isOnboardingFutureTransactionDate(dateIso: string, todayIso: string): boolean {
  const date = dateIso.trim().slice(0, 10);
  const today = todayIso.trim().slice(0, 10);
  return Boolean(date && today && date > today);
}

export function qualifiesOnboardingFutureTransaction(opts: {
  dateIso: string;
  todayIso: string;
  source?: string | null;
}): boolean {
  if (!isOnboardingFutureTransactionDate(opts.dateIso, opts.todayIso)) return false;
  if (opts.source == null || opts.source === "") return true;
  return (ONBOARDING_MANUAL_TRANSACTION_SOURCES as readonly string[]).includes(opts.source);
}

export function completionFromOnboardingStatus(
  status: OnboardingStatus | null | undefined,
  local: { calendarOpened: boolean }
): GettingStartedCompletion {
  const checklist = status?.checklist;
  return {
    account: checklist?.account ?? status?.steps.account === true,
    upcoming_transaction: checklist?.upcoming_transaction ?? false,
    recurring: checklist?.recurring ?? status?.steps.recurring === true,
    calendar: local.calendarOpened,
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
 * Collapse is honored only after meaningful progress (3 of 4).
 * Users who already finished the old 5-step checklist stay completed.
 */
export function wasPreviouslyFinishedGettingStarted(
  flags: Pick<
    GettingStartedEducationFlags,
    "getting_started_collapsed" | "calendar_intro_seen" | "home_forecast_intro_seen"
  >
): boolean {
  return (
    flags.getting_started_collapsed &&
    flags.calendar_intro_seen &&
    flags.home_forecast_intro_seen
  );
}

export function shouldShowGettingStartedCard(opts: {
  completion: GettingStartedCompletion;
  collapsed: boolean;
  educationFlags?: Pick<
    GettingStartedEducationFlags,
    "getting_started_collapsed" | "calendar_intro_seen" | "home_forecast_intro_seen"
  >;
}): boolean {
  if (isGettingStartedComplete(opts.completion)) return false;
  if (opts.educationFlags && wasPreviouslyFinishedGettingStarted(opts.educationFlags)) {
    return false;
  }
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

export function shouldShowCalendarOnboardingHandoff(opts: {
  fromOnboarding: boolean;
  handoffSeen: boolean;
}): boolean {
  return opts.fromOnboarding && !opts.handoffSeen;
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
    calendar_onboarding_handoff_seen: true,
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
