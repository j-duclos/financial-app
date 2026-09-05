import type { DtiProposedHousingInput, DtiProposedPurchaseInput } from "@budget-app/shared";

export type DtiCalculationInputsKey = {
  proposedHousing: DtiProposedHousingInput | Record<string, string> | null;
  proposedPurchase: DtiProposedPurchaseInput | Record<string, string | number> | null;
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
  proposedHousing: DtiCalculationInputsKey["proposedHousing"],
  excludedDebtItemIds: number[],
  extras?: {
    proposedPurchase?: DtiCalculationInputsKey["proposedPurchase"];
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
