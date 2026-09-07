/** Centralized review-prompt timing. Do not duplicate these in screens. */
export const REVIEW_PROMPT = {
  minHoursWithSessions: 6,
  minSessions: 2,
  minDaysFallback: 2,
  snoozeDismissDays: 30,
  snoozeReviewDeclinedDays: 90,
  snoozeNegativeDays: 90,
  maxEnjoymentPromptsPerYear: 2,
  yearWindowDays: 365,
  sessionGapMinutes: 15,
  evaluateDelayMs: 1500,
} as const;

export const FEEDBACK_MESSAGE_MAX_LENGTH = 4000;

export const FEEDBACK_CATEGORIES = [
  { id: "hard_to_use", label: "Hard to use" },
  { id: "missing_feature", label: "Missing feature" },
  { id: "something_broken", label: "Something is broken" },
  { id: "performance", label: "Performance" },
  { id: "account_sync", label: "Account / sync issue" },
  { id: "other", label: "Other" },
] as const;

export type FeedbackCategoryId = (typeof FEEDBACK_CATEGORIES)[number]["id"];
