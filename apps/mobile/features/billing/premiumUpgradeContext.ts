import { createContext } from "react";

export type PremiumUpgradeSheetApi = {
  promptUpgrade: (contextMessage?: string) => void;
};

export const PremiumUpgradeContext = createContext<PremiumUpgradeSheetApi | null>(null);
