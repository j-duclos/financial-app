export const automationQueryKeys = {
  all: ["rules"] as const,
  list: () => ["rules"] as const,
  detail: (id: number) => ["rules", id] as const,
  history: (ruleId: number, page: number) => ["rules", ruleId, "executions", page] as const,
};
