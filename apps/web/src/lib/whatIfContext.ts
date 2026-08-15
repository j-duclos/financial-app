/** Query params for opening What-If with optional context. Changes are not persisted. */

export const WHAT_IF_PATH = "/scenarios";

export function whatIfGoalPath(goalId: number | string): string {
  return `${WHAT_IF_PATH}?goal=${encodeURIComponent(String(goalId))}`;
}

export function whatIfDebtPath(accountId: number | string): string {
  return `${WHAT_IF_PATH}?debt=${encodeURIComponent(String(accountId))}`;
}

export function parsePositiveIntParam(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
