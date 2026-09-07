import type { ReviewPromptState } from "@budget-app/api-client";
import type { ReviewPromptSnapshot } from "./reviewPromptEligibility";

export const REVIEW_PROMPT_QUERY_KEY = ["review-prompt"] as const;

export function snapshotFromApi(state: ReviewPromptState | null | undefined): ReviewPromptSnapshot {
  return {
    firstEligibleUseAt: state?.first_eligible_use_at ?? null,
    sessionCount: state?.session_count ?? 0,
    lastPromptedAt: state?.last_prompted_at ?? null,
    enjoymentPromptAts: Array.isArray(state?.enjoyment_prompt_ats) ? state.enjoyment_prompt_ats : [],
    dismissedUntil: state?.dismissed_until ?? null,
    reviewFlowCompleted: Boolean(state?.review_flow_completed),
  };
}
