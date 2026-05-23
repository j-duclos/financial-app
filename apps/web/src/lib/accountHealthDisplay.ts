import { formatCurrency } from "@budget-app/shared";
import type { Account, AccountHealthDetails } from "@budget-app/shared";
import { riskStatusLabel } from "./safeToSpendLabels";

/** Short inline reason shown next to the health badge (e.g. "Watch — Low safe-to-spend"). */
export function healthInlineLabel(
  status: string | null | undefined,
  reason?: string | null
): string {
  const label = riskStatusLabel(status);
  const short = reason?.trim() || defaultHealthReason(status);
  if (!short) return label;
  return `${label} — ${short}`;
}

function defaultHealthReason(status: string | null | undefined): string | null {
  switch (status) {
    case "healthy":
      return "Above buffer";
    case "watch":
      return "Needs attention";
    case "risk":
      return "Below buffer soon";
    case "critical":
      return "Immediate action needed";
    default:
      return null;
  }
}

export type HealthDetailLines = {
  lowestProjected?: string;
  riskDate?: string;
  upcomingNote?: string;
  recommendedAction?: string;
};

export function buildHealthDetailLines(account: Account): HealthDetailLines {
  const details = account.health_details;
  const currency = account.currency;
  const lines: HealthDetailLines = {};

  const lowest =
    details?.lowest_projected_balance ?? account.lowest_projected_balance_30_days;
  if (lowest != null) {
    lines.lowestProjected = formatCurrency(lowest, currency);
  }

  const riskDate = account.health_risk_date ?? account.risk_date;
  if (riskDate) {
    lines.riskDate = new Date(riskDate + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (account.health_recommended_action) {
    lines.recommendedAction = account.health_recommended_action;
  }

  return lines;
}

export function formatHealthRiskDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  return new Date(isoDate + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function healthDetailsSummary(
  account: Account,
  details?: AccountHealthDetails | null
): string[] {
  const lines: string[] = [];
  const d = details ?? account.health_details;
  const currency = account.currency;

  const lowest = d?.lowest_projected_balance ?? account.lowest_projected_balance_30_days;
  if (lowest != null) {
    lines.push(`Lowest projected: ${formatCurrency(lowest, currency)}`);
  }

  const riskDate = account.health_risk_date ?? account.risk_date;
  if (riskDate) {
    lines.push(`Risk date: ${formatHealthRiskDate(riskDate)}`);
  }

  if (account.upcoming_outflows_30_days) {
    lines.push(
      `Upcoming outflows: ${formatCurrency(account.upcoming_outflows_30_days, currency)}`
    );
  }

  if (account.health_recommended_action) {
    lines.push(account.health_recommended_action);
  }

  return lines;
}
