export const automationQueryKeys = {
  all: ["rules"] as const,
  list: () => ["rules"] as const,
  detail: (id: number) => ["rules", id] as const,
  /** Bounded historical preview — keep separate from rule detail. */
  activityPreview: (ruleId: number, dateBefore: string) =>
    ["rules", ruleId, "activity-preview", dateBefore] as const,
};
