export const recurringQueryKeys = {
  all: ["rules"] as const,
  list: () => ["rules"] as const,
  detail: (id: number) => ["rules", id] as const,
  occurrences: (id: number, limit = 5) => ["rules", id, "occurrences", limit] as const,
  billsOverview: (month: string) => ["bills-overview", month, "recurring"] as const,
  occurrenceDetail: (id: number) => ["bill-detail", id] as const,
};
