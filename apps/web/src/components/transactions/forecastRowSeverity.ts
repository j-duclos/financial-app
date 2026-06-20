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
  isCredit: boolean;
}): ForecastRowSeverityClasses {
  const { balance, rowDate, minimumBuffer, isCredit } = params;

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

  const borderClass = "border-b border-gray-100";

  return { backgroundClass, hoverClass, borderClass };
}

/** Scheduled rule row still showing while a matching bank import awaits merge. */
export function unmatchedScheduleRowClasses(
  base?: ForecastRowSeverityClasses
): ForecastRowSeverityClasses {
  const highlight: ForecastRowSeverityClasses = {
    backgroundClass: "bg-sky-100/90",
    hoverClass: "hover:bg-sky-200/80",
    borderClass: "border-l-4 border-sky-500 border-b border-sky-200",
  };
  if (!base) return highlight;
  const keepSeverityBg =
    base.backgroundClass !== "bg-white" &&
    !base.backgroundClass.includes("sky");
  return {
    backgroundClass: keepSeverityBg ? base.backgroundClass : highlight.backgroundClass,
    hoverClass: keepSeverityBg ? base.hoverClass : highlight.hoverClass,
    borderClass: highlight.borderClass,
  };
}

export const UNMATCHED_SCHEDULE_ROW_TITLE =
  "Scheduled transaction — matching bank import found; will merge when linked";
