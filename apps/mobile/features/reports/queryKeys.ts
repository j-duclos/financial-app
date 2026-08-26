import type { ReportHistoryMonths } from "./types";

export const reportsQueryKeys = {
  monthly: (monthKey: string, householdId: number | null, historyMonths: ReportHistoryMonths) =>
    ["monthly-reports", monthKey, householdId, historyMonths] as const,
};
