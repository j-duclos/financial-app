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

/** Scheduled rule row still showing while bank imports exist on or after its date. */
export function unmatchedScheduleRowClasses(
  base?: ForecastRowSeverityClasses
): ForecastRowSeverityClasses {
  const highlight: ForecastRowSeverityClasses = {
    backgroundClass: "bg-violet-50/70",
    hoverClass: "hover:bg-violet-100/60",
    borderClass: "border-l-4 border-violet-400 border-b border-gray-100",
  };
  if (!base) return highlight;
  const keepSeverityBg =
    base.backgroundClass !== "bg-white" && base.backgroundClass !== "bg-violet-50/70";
  return {
    backgroundClass: keepSeverityBg ? base.backgroundClass : highlight.backgroundClass,
    hoverClass: keepSeverityBg ? base.hoverClass : highlight.hoverClass,
    borderClass: highlight.borderClass,
  };
}

export const UNMATCHED_SCHEDULE_ROW_TITLE =
  "Scheduled payment — bank imports exist on or after this date but none matched this occurrence";
