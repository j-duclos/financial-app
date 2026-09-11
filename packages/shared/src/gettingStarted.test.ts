import { describe, expect, it } from "vitest";
import {
  canCollapseGettingStarted,
  completionFromOnboardingStatus,
  EMPTY_GETTING_STARTED_EDUCATION,
  emptyGettingStartedCompletion,
  GETTING_STARTED_COLLAPSE_THRESHOLD,
  GETTING_STARTED_COPY,
  GETTING_STARTED_STEP_COUNT,
  GETTING_STARTED_STEPS,
  gettingStartedCompletedCount,
  homeEducationPriority,
  isGettingStartedComplete,
  isOnboardingFutureTransactionDate,
  qualifiesOnboardingFutureTransaction,
  seedGettingStartedEducation,
  shouldShowCalendarIntro,
  shouldShowCalendarOnboardingHandoff,
  shouldShowFirstAccountSuccess,
  shouldShowFirstTransactionForecast,
  shouldShowGettingStartedCard,
  shouldShowWelcomeOnce,
  type GettingStartedCompletion,
} from "./gettingStarted";
import type { OnboardingStatus } from "./onboarding";

function completion(overrides: Partial<GettingStartedCompletion> = {}): GettingStartedCompletion {
  return {
    ...emptyGettingStartedCompletion(),
    ...overrides,
  };
}

function status(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  const steps = {
    account: false,
    transaction: false,
    recurring: false,
    forecast_ready: false,
    ...overrides.steps,
  };
  return {
    completed: false,
    dismissed: false,
    show_welcome: true,
    progress: { completed_steps: 0, total_steps: 4 },
    ...overrides,
    steps,
  };
}

describe("getting started checklist completion", () => {
  it("starts incomplete for a brand-new user", () => {
    const next = completionFromOnboardingStatus(status(), { calendarOpened: false });
    expect(next).toEqual(emptyGettingStartedCompletion());
    expect(shouldShowGettingStartedCard({ completion: next, collapsed: false })).toBe(true);
    expect(GETTING_STARTED_STEPS).toHaveLength(GETTING_STARTED_STEP_COUNT);
  });

  it("marks the account step complete from real account existence", () => {
    const next = completionFromOnboardingStatus(
      status({
        checklist: {
          account: true,
          upcoming_transaction: false,
          recurring: false,
          goal: false,
        },
      }),
      { calendarOpened: false }
    );
    expect(next.account).toBe(true);
    expect(next.upcoming_transaction).toBe(false);
    expect(gettingStartedCompletedCount(next)).toBe(1);
  });

  it("marks an upcoming transaction from checklist, not a past-only or any-transaction fallback", () => {
    const next = completionFromOnboardingStatus(
      status({
        steps: { account: true, transaction: true, recurring: false, forecast_ready: true },
        checklist: {
          account: true,
          upcoming_transaction: false,
          recurring: false,
          goal: false,
        },
      }),
      { calendarOpened: false }
    );
    expect(next.upcoming_transaction).toBe(false);
  });

  it("does not treat generic transaction existence as a future transaction when checklist is absent", () => {
    const next = completionFromOnboardingStatus(
      status({
        steps: { account: true, transaction: true, recurring: false, forecast_ready: true },
      }),
      { calendarOpened: false }
    );
    expect(next.upcoming_transaction).toBe(false);
    expect(next.account).toBe(true);
  });

  it("marks recurring from checklist flags and ignores goals for completion", () => {
    const next = completionFromOnboardingStatus(
      status({
        checklist: {
          account: true,
          upcoming_transaction: true,
          recurring: true,
          goal: true,
        },
      }),
      { calendarOpened: false }
    );
    expect(next.recurring).toBe(true);
    expect(next).not.toHaveProperty("goal");
    expect(isGettingStartedComplete({ ...next, calendar: true })).toBe(true);
  });

  it("marks the calendar step from local open state", () => {
    const next = completionFromOnboardingStatus(status(), { calendarOpened: true });
    expect(next.calendar).toBe(true);
  });

  it("hides the card when all four items are complete", () => {
    const next = completion({
      account: true,
      upcoming_transaction: true,
      recurring: true,
      calendar: true,
    });
    expect(isGettingStartedComplete(next)).toBe(true);
    expect(shouldShowGettingStartedCard({ completion: next, collapsed: false })).toBe(false);
  });

  it("allows collapse after 3 of 4 and honors it", () => {
    const next = completion({
      account: true,
      upcoming_transaction: true,
      recurring: true,
      calendar: false,
    });
    expect(canCollapseGettingStarted(next)).toBe(true);
    expect(GETTING_STARTED_COLLAPSE_THRESHOLD).toBe(3);
    expect(shouldShowGettingStartedCard({ completion: next, collapsed: true })).toBe(false);
    expect(shouldShowGettingStartedCard({ completion: next, collapsed: false })).toBe(true);
  });

  it("does not stay hidden when the user has done almost nothing", () => {
    const next = completion({ account: true });
    expect(canCollapseGettingStarted(next)).toBe(false);
    expect(shouldShowGettingStartedCard({ completion: next, collapsed: true })).toBe(true);
  });

  it("keeps previously finished users completed without requiring a goal", () => {
    const partial = completion({
      account: true,
      upcoming_transaction: false,
      recurring: true,
      calendar: true,
    });
    expect(isGettingStartedComplete(partial)).toBe(false);
    expect(
      shouldShowGettingStartedCard({
        completion: partial,
        collapsed: true,
        educationFlags: {
          getting_started_collapsed: true,
          calendar_intro_seen: true,
          home_forecast_intro_seen: true,
        },
      })
    ).toBe(false);
  });
});

describe("getting started education prompts", () => {
  it("shows welcome once from backend show_welcome plus local seen flag", () => {
    expect(shouldShowWelcomeOnce({ showWelcome: true, homeForecastIntroSeen: false })).toBe(true);
    expect(shouldShowWelcomeOnce({ showWelcome: true, homeForecastIntroSeen: true })).toBe(false);
    expect(shouldShowWelcomeOnce({ showWelcome: false, homeForecastIntroSeen: false })).toBe(false);
  });

  it("shows first-account success once", () => {
    expect(shouldShowFirstAccountSuccess({ hasAccount: true, firstAccountSuccessSeen: false })).toBe(
      true
    );
    expect(shouldShowFirstAccountSuccess({ hasAccount: true, firstAccountSuccessSeen: true })).toBe(
      false
    );
    expect(shouldShowFirstAccountSuccess({ hasAccount: false, firstAccountSuccessSeen: false })).toBe(
      false
    );
  });

  it("shows first-transaction forecast once", () => {
    expect(
      shouldShowFirstTransactionForecast({
        hasUpcomingTransaction: true,
        firstTransactionForecastSeen: false,
      })
    ).toBe(true);
    expect(
      shouldShowFirstTransactionForecast({
        hasUpcomingTransaction: true,
        firstTransactionForecastSeen: true,
      })
    ).toBe(false);
  });

  it("shows calendar intro once", () => {
    expect(shouldShowCalendarIntro({ calendarIntroSeen: false })).toBe(true);
    expect(shouldShowCalendarIntro({ calendarIntroSeen: true })).toBe(false);
  });

  it("shows calendar onboarding handoff only with onboarding context and unseen flag", () => {
    expect(
      shouldShowCalendarOnboardingHandoff({ fromOnboarding: true, handoffSeen: false })
    ).toBe(true);
    expect(
      shouldShowCalendarOnboardingHandoff({ fromOnboarding: true, handoffSeen: true })
    ).toBe(false);
    expect(
      shouldShowCalendarOnboardingHandoff({ fromOnboarding: false, handoffSeen: false })
    ).toBe(false);
  });

  it("does not show all home prompts at once", () => {
    expect(
      homeEducationPriority({
        showWelcome: true,
        showFirstAccount: true,
        showFirstTransaction: true,
      })
    ).toBe("welcome");
    expect(
      homeEducationPriority({
        showWelcome: false,
        showFirstAccount: true,
        showFirstTransaction: true,
      })
    ).toBe("first_account");
    expect(
      homeEducationPriority({
        showWelcome: false,
        showFirstAccount: false,
        showFirstTransaction: true,
      })
    ).toBe("first_transaction");
  });

  it("seeds established users so one-time prompts do not appear", () => {
    const seeded = seedGettingStartedEducation({
      stored: null,
      forecastReady: true,
      completion: completion({
        account: true,
        upcoming_transaction: true,
        recurring: true,
      }),
    });
    expect(seeded.home_forecast_intro_seen).toBe(true);
    expect(seeded.first_account_success_seen).toBe(true);
    expect(seeded.first_transaction_forecast_seen).toBe(true);
    expect(seeded.calendar_intro_seen).toBe(true);
    expect(seeded.calendar_onboarding_handoff_seen).toBe(true);
    expect(seeded.getting_started_collapsed).toBe(true);
  });

  it("does not overwrite stored education flags", () => {
    const stored = {
      ...EMPTY_GETTING_STARTED_EDUCATION,
      home_forecast_intro_seen: true,
    };
    expect(
      seedGettingStartedEducation({
        stored,
        completion: completion({ account: true }),
        forecastReady: true,
      })
    ).toEqual(stored);
  });

  it("keeps brand-new users on zero education flags", () => {
    expect(
      seedGettingStartedEducation({
        stored: null,
        completion: completion(),
        forecastReady: false,
      })
    ).toEqual(EMPTY_GETTING_STARTED_EDUCATION);
  });
});

describe("getting started copy", () => {
  it("keeps the product-forward welcome and checklist copy", () => {
    expect(GETTING_STARTED_COPY.welcomeTitle).toBe("Welcome to FlowSight");
    expect(GETTING_STARTED_COPY.checklistTitle).toBe("Getting started with FlowSight");
    expect(GETTING_STARTED_COPY.checklistIntro).toMatch(/what happens next/);
    expect(GETTING_STARTED_STEPS.map((step) => step.title)).toEqual([
      "Create your first account",
      "Add a future transaction",
      "Add recurring income or a bill",
      "View your forecast calendar",
    ]);
    expect(GETTING_STARTED_STEPS).toHaveLength(4);
    expect(GETTING_STARTED_STEPS.some((step) => step.id === "goal")).toBe(false);
    expect(GETTING_STARTED_STEP_COUNT).toBe(4);
    expect(GETTING_STARTED_COPY.firstTransactionTitle).toBe("This is your forecast");
    expect(GETTING_STARTED_COPY.firstTransactionCta).toBe("Add recurring income or bill");
    expect(GETTING_STARTED_COPY.calendarCompleteTitle).toBe("You're ready");
    expect(GETTING_STARTED_COPY.calendarCompletePrimary).toBe("Go to Home");
    expect(GETTING_STARTED_COPY.optionalGoalsHint).toMatch(/Create a savings or debt goal/);
  });

  it("completes the checklist without a goal", () => {
    const next = completion({
      account: true,
      upcoming_transaction: true,
      recurring: true,
      calendar: true,
    });
    expect(isGettingStartedComplete(next)).toBe(true);
    expect(gettingStartedCompletedCount(next)).toBe(4);
  });

  it("qualifies only manually created dates after today", () => {
    const today = "2026-09-11";
    expect(isOnboardingFutureTransactionDate("2026-09-12", today)).toBe(true);
    expect(isOnboardingFutureTransactionDate("2026-09-11", today)).toBe(false);
    expect(isOnboardingFutureTransactionDate("2026-09-10", today)).toBe(false);
    expect(
      qualifiesOnboardingFutureTransaction({
        dateIso: "2026-09-12",
        todayIso: today,
        source: "ACTUAL",
      })
    ).toBe(true);
    expect(
      qualifiesOnboardingFutureTransaction({
        dateIso: "2026-09-12",
        todayIso: today,
        source: "ONE_TIME",
      })
    ).toBe(true);
    expect(
      qualifiesOnboardingFutureTransaction({
        dateIso: "2026-09-12",
        todayIso: today,
        source: "PLAID",
      })
    ).toBe(false);
    expect(
      qualifiesOnboardingFutureTransaction({
        dateIso: "2026-09-12",
        todayIso: today,
        source: "RULE",
      })
    ).toBe(false);
  });
});
