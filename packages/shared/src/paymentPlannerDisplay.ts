/** Primary CTA label for debt payment orchestration. */
export const PAYMENT_PLANNER_LABEL = "Payment Planner";

export function normalizePaymentActionLabel(label: string | null | undefined): string {
  if (!label?.trim()) return PAYMENT_PLANNER_LABEL;
  const trimmed = label.trim();
  if (/^make\s*payment$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^(open\s*)?payoff\s*planner$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^pay\s*credit\s*card$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  if (/^debt\s*payoff$/i.test(trimmed)) return PAYMENT_PLANNER_LABEL;
  return label;
}
