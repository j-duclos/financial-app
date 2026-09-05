export type DtiCalculationInputsKey = {
  proposedHousing: Record<string, string> | null;
  excludedDebtItemIds: number[];
};

export const dtiQueryKeys = {
  profile: (householdId: number) => ["dti", "profile", householdId] as const,
  incomeSources: (householdId: number) => ["dti", "income-sources", householdId] as const,
  debtItems: (householdId: number) => ["dti", "debt-items", householdId] as const,
  creditCardSuggestions: (householdId: number) =>
    ["dti", "credit-card-suggestions", householdId] as const,
  calculation: (householdId: number, inputs: DtiCalculationInputsKey) =>
    ["dti", "calculation", householdId, inputs] as const,
};

export function dtiCalculationInputsKey(
  proposedHousing: Record<string, string> | null,
  excludedDebtItemIds: number[]
): DtiCalculationInputsKey {
  return {
    proposedHousing,
    excludedDebtItemIds: [...excludedDebtItemIds].sort((a, b) => a - b),
  };
}
