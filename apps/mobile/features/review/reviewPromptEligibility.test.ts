import { describe, expect, it } from "vitest";
import { REVIEW_PROMPT } from "./reviewPromptConfig";
import {
  dismissedUntilAfterNegative,
  dismissedUntilAfterNotNow,
  dismissedUntilAfterReviewDeclined,
  enjoymentPromptsInWindow,
  hasMetUsageThreshold,
  isBlockedReviewPromptPath,
  shouldShowEnjoymentPrompt,
  type ReviewPromptGate,
  type ReviewPromptSnapshot,
} from "./reviewPromptEligibility";

const NOW = new Date("2026-09-07T12:00:00.000Z");

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function daysAgo(days: number): string {
  return hoursAgo(days * 24);
}

function snapshot(overrides: Partial<ReviewPromptSnapshot> = {}): ReviewPromptSnapshot {
  return {
    firstEligibleUseAt: hoursAgo(8),
    sessionCount: 2,
    lastPromptedAt: null,
    enjoymentPromptAts: [],
    dismissedUntil: null,
    reviewFlowCompleted: false,
    ...overrides,
  };
}

function gate(overrides: Partial<ReviewPromptGate> = {}): ReviewPromptGate {
  return {
    now: NOW,
    authenticated: true,
    bootstrapComplete: true,
    appInForeground: true,
    onboardingActive: false,
    blockingModalOpen: false,
    criticalError: false,
    criticalFundsModalOpen: false,
    blockedRoute: false,
    ...overrides,
  };
}

describe("review prompt usage threshold", () => {
  it("is not shown before 6 hours even with 2 sessions", () => {
    expect(hasMetUsageThreshold(snapshot({ firstEligibleUseAt: hoursAgo(5), sessionCount: 2 }), NOW)).toBe(
      false
    );
    expect(shouldShowEnjoymentPrompt(snapshot({ firstEligibleUseAt: hoursAgo(5), sessionCount: 2 }), gate())).toBe(
      false
    );
  });

  it("is not shown after 6 hours with only one session", () => {
    expect(hasMetUsageThreshold(snapshot({ firstEligibleUseAt: hoursAgo(7), sessionCount: 1 }), NOW)).toBe(
      false
    );
  });

  it("is shown after 6 hours and 2 sessions", () => {
    expect(hasMetUsageThreshold(snapshot({ firstEligibleUseAt: hoursAgo(6), sessionCount: 2 }), NOW)).toBe(
      true
    );
    expect(shouldShowEnjoymentPrompt(snapshot({ firstEligibleUseAt: hoursAgo(6), sessionCount: 2 }), gate())).toBe(
      true
    );
  });

  it("uses the 2-day fallback even with one session", () => {
    expect(hasMetUsageThreshold(snapshot({ firstEligibleUseAt: daysAgo(2), sessionCount: 1 }), NOW)).toBe(
      true
    );
    expect(hasMetUsageThreshold(snapshot({ firstEligibleUseAt: hoursAgo(47), sessionCount: 1 }), NOW)).toBe(
      false
    );
  });
});

describe("review prompt gates", () => {
  it("is not shown during onboarding", () => {
    expect(shouldShowEnjoymentPrompt(snapshot(), gate({ onboardingActive: true }))).toBe(false);
  });

  it("is not shown when a modal is already open", () => {
    expect(shouldShowEnjoymentPrompt(snapshot(), gate({ blockingModalOpen: true }))).toBe(false);
  });

  it("is not shown during a critical flow or blocked route", () => {
    expect(shouldShowEnjoymentPrompt(snapshot(), gate({ blockedRoute: true }))).toBe(false);
    expect(shouldShowEnjoymentPrompt(snapshot(), gate({ criticalFundsModalOpen: true }))).toBe(false);
    expect(shouldShowEnjoymentPrompt(snapshot(), gate({ criticalError: true }))).toBe(false);
    expect(isBlockedReviewPromptPath("/(app)/transaction/edit/12")).toBe(true);
    expect(isBlockedReviewPromptPath("/(auth)/login")).toBe(true);
    expect(isBlockedReviewPromptPath("/(app)/(tabs)/index")).toBe(false);
  });

  it("requires auth, foreground, and bootstrap", () => {
    expect(shouldShowEnjoymentPrompt(snapshot(), gate({ authenticated: false }))).toBe(false);
    expect(shouldShowEnjoymentPrompt(snapshot(), gate({ appInForeground: false }))).toBe(false);
    expect(shouldShowEnjoymentPrompt(snapshot(), gate({ bootstrapComplete: false }))).toBe(false);
  });
});

describe("review prompt anti-nag", () => {
  it("Not now snoozes 30 days", () => {
    const until = dismissedUntilAfterNotNow(NOW);
    expect(until).toBe(new Date(NOW.getTime() + REVIEW_PROMPT.snoozeDismissDays * 24 * 60 * 60 * 1000).toISOString());
    expect(
      shouldShowEnjoymentPrompt(snapshot({ dismissedUntil: until }), gate({ now: NOW }))
    ).toBe(false);
  });

  it("review no snoozes 90 days", () => {
    const until = dismissedUntilAfterReviewDeclined(NOW);
    expect(until).toBe(
      new Date(NOW.getTime() + REVIEW_PROMPT.snoozeReviewDeclinedDays * 24 * 60 * 60 * 1000).toISOString()
    );
    expect(shouldShowEnjoymentPrompt(snapshot({ dismissedUntil: until }), gate())).toBe(false);
  });

  it("negative flow snoozes 90 days", () => {
    const until = dismissedUntilAfterNegative(NOW);
    expect(until).toBe(
      new Date(NOW.getTime() + REVIEW_PROMPT.snoozeNegativeDays * 24 * 60 * 60 * 1000).toISOString()
    );
    expect(shouldShowEnjoymentPrompt(snapshot({ dismissedUntil: until }), gate())).toBe(false);
  });

  it("positive completed flow does not re-prompt", () => {
    expect(shouldShowEnjoymentPrompt(snapshot({ reviewFlowCompleted: true }), gate())).toBe(false);
  });

  it("caps enjoyment prompts at 2 per 12 months", () => {
    const state = snapshot({
      enjoymentPromptAts: [daysAgo(10), daysAgo(20)],
    });
    expect(enjoymentPromptsInWindow(state, NOW)).toBe(2);
    expect(shouldShowEnjoymentPrompt(state, gate())).toBe(false);
    expect(
      shouldShowEnjoymentPrompt(
        snapshot({ enjoymentPromptAts: [daysAgo(400), daysAgo(10)] }),
        gate()
      )
    ).toBe(true);
  });
});
