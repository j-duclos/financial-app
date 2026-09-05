export type DtiCalculationInputsKey = {
  proposedHousing: Record<string, string> | null;
  proposedPurchase: Record<string, string | number> | null;
  proposedHousingMode: "monthly_payment" | "purchase" | null;
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
  excludedDebtItemIds: number[],
  extras?: {
    proposedPurchase?: Record<string, string | number> | null;
    proposedHousingMode?: "monthly_payment" | "purchase" | null;
  }
): DtiCalculationInputsKey {
  return {
    proposedHousing,
    proposedPurchase: extras?.proposedPurchase ?? null,
    proposedHousingMode:
      extras?.proposedHousingMode ?? (proposedHousing ? "monthly_payment" : null),
    excludedDebtItemIds: [...excludedDebtItemIds].sort((a, b) => a - b),
  };
}
