import { REVIEW_PROMPT } from "./reviewPromptConfig";

export type ReviewPromptSnapshot = {
  firstEligibleUseAt: string | null;
  sessionCount: number;
  lastPromptedAt: string | null;
  enjoymentPromptAts: string[];
  dismissedUntil: string | null;
  reviewFlowCompleted: boolean;
};

export type ReviewPromptGate = {
  now: Date;
  authenticated: boolean;
  bootstrapComplete: boolean;
  appInForeground: boolean;
  onboardingActive: boolean;
  blockingModalOpen: boolean;
  criticalError: boolean;
  criticalFundsModalOpen: boolean;
  blockedRoute: boolean;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function addUtcDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

export function toIso(date: Date): string {
  return date.toISOString();
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function hasMetUsageThreshold(state: ReviewPromptSnapshot, now: Date): boolean {
  const first = parseTime(state.firstEligibleUseAt);
  if (first == null) return false;
  const elapsed = now.getTime() - first;
  if (elapsed >= REVIEW_PROMPT.minDaysFallback * DAY_MS) return true;
  return (
    elapsed >= REVIEW_PROMPT.minHoursWithSessions * HOUR_MS &&
    state.sessionCount >= REVIEW_PROMPT.minSessions
  );
}

export function enjoymentPromptsInWindow(state: ReviewPromptSnapshot, now: Date): number {
  const windowMs = REVIEW_PROMPT.yearWindowDays * DAY_MS;
  return (state.enjoymentPromptAts ?? []).filter((iso) => {
    const ms = parseTime(iso);
    return ms != null && now.getTime() - ms < windowMs;
  }).length;
}

export function isSnoozed(state: ReviewPromptSnapshot, now: Date): boolean {
  const until = parseTime(state.dismissedUntil);
  return until != null && until > now.getTime();
}

export function shouldShowEnjoymentPrompt(state: ReviewPromptSnapshot, gate: ReviewPromptGate): boolean {
  if (!gate.bootstrapComplete) return false;
  if (!gate.authenticated) return false;
  if (!gate.appInForeground) return false;
  if (gate.onboardingActive) return false;
  if (gate.blockingModalOpen) return false;
  if (gate.criticalError) return false;
  if (gate.criticalFundsModalOpen) return false;
  if (gate.blockedRoute) return false;
  if (state.reviewFlowCompleted) return false;
  if (isSnoozed(state, gate.now)) return false;
  if (enjoymentPromptsInWindow(state, gate.now) >= REVIEW_PROMPT.maxEnjoymentPromptsPerYear) {
    return false;
  }
  return hasMetUsageThreshold(state, gate.now);
}

export function dismissedUntilAfterNotNow(now: Date): string {
  return toIso(addUtcDays(now, REVIEW_PROMPT.snoozeDismissDays));
}

export function dismissedUntilAfterReviewDeclined(now: Date): string {
  return toIso(addUtcDays(now, REVIEW_PROMPT.snoozeReviewDeclinedDays));
}

export function dismissedUntilAfterNegative(now: Date): string {
  return toIso(addUtcDays(now, REVIEW_PROMPT.snoozeNegativeDays));
}

export function isBlockedReviewPromptPath(pathname: string | null | undefined): boolean {
  const p = (pathname ?? "").toLowerCase();
  if (!p) return false;
  if (p.includes("/login") || p.includes("/register")) return true;
  if (p.includes("forgot-password") || p.includes("reset-password")) return true;
  if (p.includes("plaid") || p.includes("oauth")) return true;
  if (p.includes("checkout") || p.includes("/billing")) return true;
  if (p.includes("/transaction/edit") || p.includes("/transaction/new")) return true;
  return false;
}
