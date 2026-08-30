/** Whether a row is already linked to a bank import (status only — not an action). */
export function isImportMatchStatusMatched(importMatchStatus?: string | null): boolean {
  return (importMatchStatus ?? "").toLowerCase() === "matched";
}

/** Candidates the user may confirm — backend may attach advisory `reject` hints. */
export function selectableImportMatchCandidates<T extends { reject?: string | null }>(
  candidates: readonly T[]
): T[] {
  return candidates.filter((c) => !c.reject);
}

export const MATCH_IMPORTED_TRANSACTION_LABEL = "Match imported transaction";

export const NO_IMPORT_CANDIDATES_MESSAGE = "No unmatched bank imports were found.";
