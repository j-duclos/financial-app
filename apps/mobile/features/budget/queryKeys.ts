export const budgetQueryKeys = {
  households: ["households"] as const,
  summary: (householdId: number | null, monthKey: string, anchor: string) =>
    ["spending-targets-summary", householdId, monthKey, anchor] as const,
  targets: (householdId: number | null, monthKey: string, anchor: string) =>
    ["spending-targets", householdId, monthKey, anchor] as const,
  categories: (householdId: number | null) => ["categories", "spending-targets", householdId] as const,
  suggestType: (categoryId: number) => ["spending-target-suggest-type", categoryId] as const,
  targetDetail: (targetId: number, anchor: string) => ["spending-target", targetId, anchor] as const,
};
