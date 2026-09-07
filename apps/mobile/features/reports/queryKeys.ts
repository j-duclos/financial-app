export const reportsQueryKeys = {
  monthly: (monthKey: string, householdId: number | null, historyMonths: number) =>
    ["monthly-reports", monthKey, householdId, historyMonths] as const,
};
