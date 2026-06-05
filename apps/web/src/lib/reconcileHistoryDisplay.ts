import type { ReconciliationSessionSummary } from "@budget-app/shared";

/** Text for the page header last-reconciled line. */
export function lastReconciledLabel(lastPeriodEnd: string | null | undefined): string {
  if (!lastPeriodEnd) return "Never";
  return lastPeriodEnd;
}

/** Only the latest active session may be undone. */
export function markUndoableSessions(
  sessions: ReconciliationSessionSummary[],
): ReconciliationSessionSummary[] {
  const latestActive = sessions.find((s) => s.is_active);
  return sessions.map((s) => ({
    ...s,
    can_undo: latestActive != null && s.id === latestActive.id && s.is_active,
  }));
}

/** Human-readable status for a history row. */
export function sessionStatusLabel(session: ReconciliationSessionSummary): string {
  if (!session.is_active) return "Undone";
  return session.is_balanced ? "Balanced" : "Unbalanced";
}
