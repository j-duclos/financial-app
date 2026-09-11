import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GETTING_STARTED_COPY,
  GETTING_STARTED_HELP_LABELS,
  GETTING_STARTED_STEPS,
  canCollapseGettingStarted,
  completionFromOnboardingStatus,
  emptyGettingStartedCompletion,
  isGettingStartedComplete,
  seedGettingStartedEducation,
  shouldShowGettingStartedCard,
} from "@budget-app/shared";
import {
  educationFlagsEqual,
  gettingStartedEducationStorageKey,
  parseGettingStartedEducation,
  serializeGettingStartedEducation,
  setGettingStartedEducationCache,
  subscribeGettingStartedEducation,
} from "./gettingStartedStorage";
import { GETTING_STARTED_ROUTES } from "./gettingStartedRoutes";

const dir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(dir, "../..");

function read(rel: string): string {
  return readFileSync(join(mobileRoot, rel), "utf8");
}

const dashboardSource = read("features/dashboard/DashboardScreen.tsx");
const firstRunSource = read("features/dashboard/DashboardFirstRun.tsx");
const healthSource = read("features/dashboard/FinancialHealthSection.tsx");
const attentionSource = read("features/dashboard/AttentionRequiredSection.tsx");
const detailsSource = read("features/dashboard/DashboardDetailsSections.tsx");
const calendarSource = read("features/calendar/CalendarScreen.tsx");
const recurringSource = read("features/recurring/RecurringListScreen.tsx");
const cardSource = read("features/onboarding/GettingStartedCard.tsx");
const welcomeSource = read("features/onboarding/OnboardingWelcomeSheet.tsx");
const hookSource = read("features/onboarding/useGettingStartedEducation.ts");
const refreshSource = read("lib/financialQueryRefresh.ts");
const goalKeysSource = read("features/goals/queryKeys.ts");

describe("getting started storage", () => {
  it("keys education flags per user and shares updates in memory", () => {
    expect(gettingStartedEducationStorageKey(42)).toBe("getting-started-education:42");
    expect(read("features/onboarding/gettingStartedStorage.ts")).toMatch(
      /resetGettingStartedEducation/
    );
    expect(hookSource).toMatch(/Cache was reset from outside this hook/);
    expect(hookSource).toMatch(/setGettingStartedEducationCache/);
    expect(hookSource).toMatch(/subscribeGettingStartedEducation/);
    expect(hookSource).toMatch(/educationFlagsEqual/);
    expect(hookSource).not.toMatch(/setGettingStartedEducationCache\(userId, next\)[\s\S]{0,80}return next/);
  });

  it("round-trips persisted flags and ignores corrupt payloads", () => {
    const raw = serializeGettingStartedEducation({
      home_forecast_intro_seen: true,
      first_account_success_seen: false,
      first_transaction_forecast_seen: true,
      calendar_intro_seen: false,
      calendar_onboarding_handoff_seen: false,
      getting_started_collapsed: true,
    });
    expect(parseGettingStartedEducation(raw)).toEqual({
      home_forecast_intro_seen: true,
      first_account_success_seen: false,
      first_transaction_forecast_seen: true,
      calendar_intro_seen: false,
      calendar_onboarding_handoff_seen: false,
      getting_started_collapsed: true,
    });
    expect(parseGettingStartedEducation("not-json")).toBeNull();
    expect(parseGettingStartedEducation(null)).toBeNull();
    expect(
      parseGettingStartedEducation(
        JSON.stringify({
          home_forecast_intro_seen: true,
          first_account_success_seen: false,
          first_transaction_forecast_seen: false,
          calendar_intro_seen: false,
          getting_started_collapsed: false,
        })
      )
    ).toMatchObject({ calendar_onboarding_handoff_seen: false });
  });

  it("does not notify other screens synchronously from a cache write", async () => {
    let calls = 0;
    const unsub = subscribeGettingStartedEducation(() => {
      calls += 1;
    });
    setGettingStartedEducationCache(9001, {
      home_forecast_intro_seen: false,
      first_account_success_seen: false,
      first_transaction_forecast_seen: false,
      calendar_intro_seen: true,
      calendar_onboarding_handoff_seen: false,
      getting_started_collapsed: false,
    });
    expect(calls).toBe(0);
    await Promise.resolve();
    expect(calls).toBe(1);
    unsub();
  });

  it("treats identical education flags as equal", () => {
    const flags = {
      home_forecast_intro_seen: true,
      first_account_success_seen: false,
      first_transaction_forecast_seen: true,
      calendar_intro_seen: false,
      calendar_onboarding_handoff_seen: false,
      getting_started_collapsed: true,
    };
    expect(educationFlagsEqual(flags, { ...flags })).toBe(true);
    expect(educationFlagsEqual(flags, { ...flags, calendar_intro_seen: true })).toBe(false);
  });
});

describe("getting started checklist on Home", () => {
  it("shows the Getting Started card for a brand-new user", () => {
    const completion = completionFromOnboardingStatus(
      {
        completed: false,
        dismissed: false,
        show_welcome: true,
        steps: {
          account: false,
          transaction: false,
          recurring: false,
          forecast_ready: false,
        },
        progress: { completed_steps: 0, total_steps: 4 },
        checklist: {
          account: false,
          upcoming_transaction: false,
          recurring: false,
          goal: false,
        },
      },
      { calendarOpened: false }
    );
    expect(completion).toEqual(emptyGettingStartedCompletion());
    expect(shouldShowGettingStartedCard({ completion, collapsed: false })).toBe(true);
    expect(dashboardSource).toMatch(/GettingStartedCard/);
    expect(dashboardSource).toMatch(/gettingStartedCard/);
    expect(dashboardSource).toMatch(/if \(firstRun\)/);
    expect(cardSource).toMatch(/GETTING_STARTED_COPY\.checklistTitle/);
    expect(GETTING_STARTED_COPY.checklistTitle).toBe("Getting started with FlowSight");
  });

  it("marks each core step from real data", () => {
    const withAccount = completionFromOnboardingStatus(
      {
        completed: false,
        dismissed: false,
        show_welcome: true,
        steps: { account: true, transaction: false, recurring: false, forecast_ready: false },
        progress: { completed_steps: 1, total_steps: 4 },
        checklist: {
          account: true,
          upcoming_transaction: false,
          recurring: false,
          goal: false,
        },
      },
      { calendarOpened: false }
    );
    expect(withAccount.account).toBe(true);

    const withTxn = {
      ...withAccount,
      upcoming_transaction: true,
    };
    expect(withTxn.upcoming_transaction).toBe(true);

    const withRecurring = { ...withTxn, recurring: true };
    expect(withRecurring.recurring).toBe(true);

    const withCalendar = { ...withRecurring, calendar: true };
    expect(withCalendar.calendar).toBe(true);
    expect(isGettingStartedComplete(withCalendar)).toBe(true);
    expect(shouldShowGettingStartedCard({ completion: withCalendar, collapsed: false })).toBe(false);
    expect(GETTING_STARTED_STEPS).toHaveLength(4);
    expect(GETTING_STARTED_STEPS.some((step) => step.id === "goal")).toBe(false);
  });

  it("hides or collapses when setup is complete enough, and keeps previously finished users completed", () => {
    const threeOfFour = {
      account: true,
      upcoming_transaction: true,
      recurring: true,
      calendar: false,
    };
    expect(canCollapseGettingStarted(threeOfFour)).toBe(true);
    expect(shouldShowGettingStartedCard({ completion: threeOfFour, collapsed: true })).toBe(false);

    const almostNothing = { ...emptyGettingStartedCompletion(), account: true };
    expect(shouldShowGettingStartedCard({ completion: almostNothing, collapsed: true })).toBe(true);

    const finished = { ...threeOfFour, calendar: true };
    expect(shouldShowGettingStartedCard({ completion: finished, collapsed: false })).toBe(false);
    expect(
      shouldShowGettingStartedCard({
        completion: almostNothing,
        collapsed: true,
        educationFlags: {
          getting_started_collapsed: true,
          calendar_intro_seen: true,
          home_forecast_intro_seen: true,
        },
      })
    ).toBe(false);
  });

  it("routes checklist actions to existing screens without upgrade CTAs", () => {
    expect(GETTING_STARTED_ROUTES.account).toBe("/account/new");
    expect(GETTING_STARTED_ROUTES.upcoming_transaction).toBe(
      "/transaction/new?source=onboarding&mode=future"
    );
    expect(GETTING_STARTED_ROUTES.recurring).toBe("/recurring/new?source=onboarding");
    expect(GETTING_STARTED_ROUTES.calendar).toBe("/(app)/(tabs)/calendar?source=onboarding");
    expect(GETTING_STARTED_ROUTES).not.toHaveProperty("goal");
    expect(cardSource).not.toMatch(/Upgrade/);
    expect(cardSource).not.toMatch(/Premium/);
    expect(cardSource).not.toMatch(/startUpgrade/);
    expect(cardSource).toMatch(/of \{GETTING_STARTED_STEP_COUNT\} complete/);
    expect(GETTING_STARTED_STEPS.map((step) => GETTING_STARTED_ROUTES[step.id])).toEqual([
      "/account/new",
      "/transaction/new?source=onboarding&mode=future",
      "/recurring/new?source=onboarding",
      "/(app)/(tabs)/calendar?source=onboarding",
    ]);
  });

  it("exposes complete/incomplete status in accessible labels", () => {
    expect(cardSource).toMatch(/\$\{step\.title\}, \$\{done \? "complete" : "not complete"\}/);
    expect(cardSource).toMatch(/minHeight: theme\.touchTarget/);
  });
});

describe("dashboard education and first-run prompts", () => {
  it("updates first-run welcome copy and shows a one-page welcome sheet", () => {
    expect(firstRunSource).toMatch(/GETTING_STARTED_COPY\.welcomeTitle/);
    expect(firstRunSource).toMatch(/GETTING_STARTED_COPY\.welcomeBody/);
    expect(welcomeSource).toMatch(/GETTING_STARTED_COPY\.welcomeCta/);
    expect(welcomeSource).toMatch(/GETTING_STARTED_COPY\.welcomeSkip/);
    expect(welcomeSource).not.toMatch(/carousel/i);
    expect(dashboardSource).toMatch(/OnboardingWelcomeSheet/);
    expect(dashboardSource).toMatch(/homePrompt === "welcome"/);
  });

  it("shows first-account and first-transaction education once", () => {
    expect(dashboardSource).toMatch(/homePrompt === "first_account"/);
    expect(dashboardSource).toMatch(/homePrompt === "first_transaction"/);
    expect(dashboardSource).toMatch(/markFirstAccountSeen/);
    expect(dashboardSource).toMatch(/markFirstTransactionSeen/);
    expect(dashboardSource).toMatch(/testID="first-account-success"/);
    expect(dashboardSource).toMatch(/testID="first-transaction-forecast"/);
    expect(GETTING_STARTED_COPY.firstAccountTitle).toBe("Your forecast has started");
    expect(GETTING_STARTED_COPY.firstTransactionTitle).toBe("This is your forecast");
    expect(GETTING_STARTED_COPY.firstTransactionCta).toBe("Add recurring income or bill");
    expect(GETTING_STARTED_COPY.firstTransactionSecondary).toBe("View forecast calendar");
    expect(dashboardSource).toMatch(/GETTING_STARTED_ROUTES\.upcoming_transaction/);
    expect(dashboardSource).toMatch(/GETTING_STARTED_ROUTES\.recurring/);
    expect(dashboardSource).toMatch(/GETTING_STARTED_ROUTES\.calendar/);
  });

  it("opens concept help from info icons with accessible labels", () => {
    expect(healthSource).toMatch(/GETTING_STARTED_HELP_LABELS\.lowestForecastBalance/);
    expect(healthSource).toMatch(/GETTING_STARTED_HELP_LABELS\.availableCash/);
    expect(attentionSource).toMatch(/GETTING_STARTED_HELP_LABELS\.attentionRequired/);
    expect(detailsSource).toMatch(/GETTING_STARTED_HELP_LABELS\.upcomingMoneyFlow/);
    expect(detailsSource).toMatch(/GETTING_STARTED_HELP_LABELS\.goalsProgress/);
    expect(detailsSource).toMatch(/GETTING_STARTED_COPY\.optionalGoalsHint/);
    expect(dashboardSource).toMatch(/DashboardConceptHelpSheet/);
    expect(GETTING_STARTED_HELP_LABELS.lowestForecastBalance).toBe("About Lowest Forecast Balance");
    expect(GETTING_STARTED_COPY.help.availableCash).toMatch(/checking and savings/);
  });

  it("explains recurring empty state and shows calendar intro once", () => {
    expect(recurringSource).toMatch(/GETTING_STARTED_COPY\.recurringEmpty/);
    expect(calendarSource).toMatch(/markCalendarOpened/);
    expect(calendarSource).toMatch(/calendarIntroVisible/);
    expect(calendarSource).toMatch(/testID="calendar-intro"/);
    expect(GETTING_STARTED_COPY.calendarIntro).toMatch(/projected balance/);
  });

  it("persists one-time flags locally and seeds established users", () => {
    expect(hookSource).toMatch(/AsyncStorage/);
    expect(hookSource).toMatch(/gettingStartedEducationStorageKey/);
    expect(hookSource).toMatch(/home_forecast_intro_seen/);
    expect(hookSource).toMatch(/first_account_success_seen/);
    expect(hookSource).toMatch(/first_transaction_forecast_seen/);
    expect(hookSource).toMatch(/calendar_intro_seen/);
    expect(hookSource).toMatch(/calendar_onboarding_handoff_seen/);
    expect(hookSource).toMatch(/getting_started_collapsed/);
    expect(hookSource).toMatch(/educationFlags: flags/);
    const seeded = seedGettingStartedEducation({
      stored: null,
      forecastReady: true,
      completion: {
        account: true,
        upcoming_transaction: true,
        recurring: true,
        calendar: false,
      },
    });
    expect(seeded.first_account_success_seen).toBe(true);
    expect(seeded.first_transaction_forecast_seen).toBe(true);
    expect(seeded.calendar_intro_seen).toBe(true);
  });

  it("refreshes onboarding status after account, transaction, recurring, and goal mutations", () => {
    expect(refreshSource).toMatch(/invalidateOnboardingStatus/);
    expect(refreshSource).toMatch(/refreshAfterTransactionEdit/);
    expect(refreshSource).toMatch(/invalidateRecurringRuleDependents/);
    expect(goalKeysSource).toMatch(/invalidateOnboardingStatus/);
  });

  it("keeps Free account and transaction setup usable without Premium in the checklist", () => {
    expect(cardSource).not.toMatch(/atPlanLimit/);
    expect(dashboardSource).toMatch(/GETTING_STARTED_ROUTES/);
    expect(firstRunSource).toMatch(/Add account manually/);
    expect(GETTING_STARTED_ROUTES.account).toBe("/account/new");
    expect(GETTING_STARTED_ROUTES.upcoming_transaction).toBe(
      "/transaction/new?source=onboarding&mode=future"
    );
  });
});
