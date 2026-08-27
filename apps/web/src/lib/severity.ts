export {
  SEVERITY_LEVELS,
  normalizeSeverity,
  severityRank,
  severityShowsAlert,
  severityLabel,
  severityIconEmoji,
  type SeverityLevel,
} from "@budget-app/shared/severity";

import {
  normalizeSeverity,
  severityLabel,
  severityIconEmoji,
  type SeverityLevel,
} from "@budget-app/shared/severity";

export type SeverityTokens = {
  level: SeverityLevel;
  label: string;
  badgeClass: string;
  cardClass: string;
  dotClass: string;
  headerAccentClass: string;
  warningTextClass: string;
  iconClass: string;
  cellClass: string;
  rowTintClass: string;
  netClass: string;
  endingClass: string;
};

function tokensFor(level: SeverityLevel): Omit<SeverityTokens, "level" | "label"> {
  switch (level) {
    case "critical":
      return {
        badgeClass: "bg-red-700 text-white border border-red-800/40 shadow-sm",
        cardClass:
          "border-2 border-red-400/90 bg-gradient-to-br from-red-50 to-orange-50/90 shadow-md ring-1 ring-red-200/70",
        dotClass: "bg-red-600 ring-red-200",
        headerAccentClass: "border-l-4 border-l-red-600 bg-red-50/50",
        warningTextClass: "text-red-800",
        iconClass: "text-red-600",
        cellClass:
          "bg-red-50/95 border-2 border-red-400 shadow-sm shadow-red-100/80 hover:bg-red-100/90 hover:shadow-md",
        rowTintClass: "bg-red-50/40",
        netClass: "text-red-800 font-semibold",
        endingClass: "text-red-900 font-bold tabular-nums",
      };
    case "at_risk":
      return {
        badgeClass: "bg-amber-100 text-amber-950 border border-amber-300/90",
        cardClass: "border border-amber-300/90 bg-amber-50/95 shadow-sm ring-1 ring-amber-200/60",
        dotClass: "bg-amber-500 ring-amber-200",
        headerAccentClass: "border-l-4 border-l-amber-500 bg-amber-50/40",
        warningTextClass: "text-amber-950",
        iconClass: "text-amber-600",
        cellClass: "bg-amber-50/80 border-amber-300 hover:bg-amber-100/80",
        rowTintClass: "bg-amber-50/30",
        netClass: "text-amber-950 font-medium",
        endingClass: "text-amber-950 font-semibold tabular-nums",
      };
    case "watch":
      return {
        badgeClass: "bg-yellow-50 text-yellow-900 border border-yellow-200/90",
        cardClass: "border border-yellow-200/80 bg-yellow-50/40 ring-1 ring-yellow-100/80",
        dotClass: "bg-yellow-400 ring-yellow-100",
        headerAccentClass: "border-l-4 border-l-yellow-400 bg-yellow-50/30",
        warningTextClass: "text-yellow-900",
        iconClass: "text-yellow-700",
        cellClass: "bg-yellow-50/50 border-yellow-200/70 hover:bg-yellow-50/80",
        rowTintClass: "bg-yellow-50/20",
        netClass: "text-yellow-900 font-medium",
        endingClass: "text-gray-800 font-medium tabular-nums",
      };
    default:
      return {
        badgeClass: "bg-emerald-100 text-emerald-800 border border-emerald-200",
        cardClass: "border border-gray-200 bg-white",
        dotClass: "bg-emerald-500 ring-emerald-200",
        headerAccentClass: "border-l-4 border-l-emerald-400 bg-emerald-50/25",
        warningTextClass: "text-gray-700",
        iconClass: "text-gray-500",
        cellClass: "bg-emerald-50/40 border-emerald-100 hover:bg-emerald-50/70",
        rowTintClass: "",
        netClass: "text-gray-800",
        endingClass: "text-gray-800 font-medium tabular-nums",
      };
  }
}

export function severityTokens(input: string | null | undefined): SeverityTokens {
  const level = normalizeSeverity(input);
  return {
    level,
    label: severityLabel(level),
    ...tokensFor(level),
  };
}

export function severityCalendarCellClass(
  level: SeverityLevel,
  hasActivity: boolean
): string {
  if (level === "healthy" && !hasActivity) {
    return "bg-white/80 border-gray-100 text-gray-500 hover:bg-gray-50 hover:border-gray-200";
  }
  if (level === "healthy") {
    return tokensFor("healthy").cellClass + " hover:bg-emerald-50/70";
  }
  return tokensFor(level).cellClass;
}

export function severityNetClass(level: SeverityLevel, net: number): string {
  if (level === "healthy") {
    return net >= 0 ? "text-gray-800" : "text-red-700";
  }
  return tokensFor(level).netClass;
}

export function severityEndingClass(level: SeverityLevel, ending: number): string {
  if (level === "critical" && ending < 0) {
    return tokensFor("critical").endingClass;
  }
  if (level === "healthy") {
    return tokensFor("healthy").endingClass;
  }
  return tokensFor(level).endingClass;
}

export { severityIconEmoji as severityIconEmojiWeb };
