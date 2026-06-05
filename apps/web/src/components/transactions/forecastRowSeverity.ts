import { severityTokens } from "../../lib/severity";

export type ForecastRowSeverityClasses = {
  backgroundClass: string;
  hoverClass: string;
  borderClass: string;
};

/** Background + border styling for forecast ledger rows (bank accounts use buffer / negative rules). */
export function forecastRowSeverityClasses(params: {
  balance: number;
  rowDate: string;
  minimumBuffer: number | null;
  riskDate: string | null;
  isCredit: boolean;
}): ForecastRowSeverityClasses {
  const { balance, rowDate, minimumBuffer, riskDate, isCredit } = params;
  const isRiskDate = riskDate != null && rowDate === riskDate;

  let backgroundClass = "bg-white";
  let hoverClass = "hover:bg-gray-50/80";

  if (!isCredit) {
    if (balance < -0.005) {
      backgroundClass = severityTokens("critical").rowTintClass || "bg-red-50";
      hoverClass = "hover:bg-red-100/60";
    } else if (minimumBuffer != null && minimumBuffer > 0 && balance < minimumBuffer) {
      backgroundClass = severityTokens("at_risk").rowTintClass || "bg-amber-50/80";
      hoverClass = "hover:bg-amber-100/60";
    }
  }

  const borderClass = isRiskDate
    ? "border-y-2 border-amber-400"
    : "border-b border-gray-100";

  return { backgroundClass, hoverClass, borderClass };
}
