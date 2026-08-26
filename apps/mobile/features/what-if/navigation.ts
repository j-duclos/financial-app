export function parsePositiveIntParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function whatIfGoalParams(goalId: number): { goal: string } {
  return { goal: String(goalId) };
}

export function whatIfDebtParams(debtId: number): { debt: string } {
  return { debt: String(debtId) };
}
