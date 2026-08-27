/**
 * Canonical severity hierarchy for dashboard, accounts, recommendations, and calendar.
 *
 * Levels (most to least urgent): critical → at_risk → watch → healthy
 */
export const SEVERITY_LEVELS = ["critical", "at_risk", "watch", "healthy"] as const;

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

const ALIASES: Record<string, SeverityLevel> = {
  critical: "critical",
  dangerous: "critical",
  risk: "at_risk",
  at_risk: "at_risk",
  "at-risk": "at_risk",
  warning: "at_risk",
  tight: "at_risk",
  watch: "watch",
  info: "watch",
  healthy: "healthy",
  positive: "healthy",
  neutral: "healthy",
  none: "healthy",
};

export function normalizeSeverity(input: string | null | undefined): SeverityLevel {
  if (!input) return "healthy";
  const key = input.trim().toLowerCase().replace(/\s+/g, "_");
  return ALIASES[key] ?? "watch";
}

export function severityRank(level: SeverityLevel): number {
  switch (level) {
    case "critical":
      return 0;
    case "at_risk":
      return 1;
    case "watch":
      return 2;
    default:
      return 3;
  }
}

export function severityShowsAlert(level: SeverityLevel): boolean {
  return level !== "healthy";
}

export function severityLabel(level: SeverityLevel): string {
  switch (level) {
    case "critical":
      return "Critical";
    case "at_risk":
      return "At Risk";
    case "watch":
      return "Watch";
    default:
      return "Healthy";
  }
}

/** Calendar / heat emoji by severity (healthy days stay quiet). */
export function severityIconEmoji(level: SeverityLevel): string {
  switch (level) {
    case "critical":
      return "🔴";
    case "at_risk":
      return "🟠";
    case "watch":
      return "🟡";
    default:
      return "🟢";
  }
}
