/** Server-authored projected funds alerts — clients display these, they do not calculate risk. */

export type ProjectedFundsAlertType = "INSUFFICIENT_FUNDS" | "CREDIT_LIMIT_RISK";

export type ProjectedFundsAlertSeverity = "WATCH" | "AT_RISK" | "CRITICAL";

export type ProjectedFundsAlert = {
  id: number;
  household: number;
  account: number;
  account_name: string;
  transaction: number | null;
  rule: number | null;
  occurrence_date: string;
  fingerprint: string;
  alert_type: ProjectedFundsAlertType;
  severity: ProjectedFundsAlertSeverity;
  amount: string;
  projected_balance_before: string;
  projected_balance_after: string;
  shortfall: string;
  shortfall_display: string;
  payee: string;
  title: string;
  body: string;
  banner_message: string;
  active: boolean;
  first_detected_at: string;
  last_evaluated_at: string;
  resolved_at: string | null;
  dismissed_at: string | null;
  read_at: string | null;
};

export type PushDevice = {
  id: number;
  expo_push_token: string;
  platform: "ios" | "android" | "web" | "unknown";
  device_id: string;
  enabled: boolean;
  created_at: string;
  last_seen_at: string;
};

export const PROJECTED_FUNDS_ALERTS_QUERY_KEY = ["projected-funds-alerts"] as const;

export function projectedFundsLedgerPath(alert: Pick<ProjectedFundsAlert, "account" | "occurrence_date">): string {
  return `/transactions?account=${alert.account}&date=${alert.occurrence_date}&focus=upcoming`;
}

export function projectedFundsForecastPath(alert: Pick<ProjectedFundsAlert, "account">): string {
  return `/accounts?account=${alert.account}`;
}

export function projectedFundsActionCenterPath(alertId?: number | null): string {
  if (alertId == null) return "/action-center";
  return `/action-center?alert=${alertId}`;
}

export function parseProjectedFundsAlertId(
  params: { alert?: string | string[] | null } | URLSearchParams | null | undefined
): number | null {
  if (!params) return null;
  const raw =
    params instanceof URLSearchParams
      ? params.get("alert")
      : Array.isArray(params.alert)
        ? params.alert[0]
        : params.alert;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function activeProjectedFundsAlerts(alerts: ProjectedFundsAlert[] | undefined | null): ProjectedFundsAlert[] {
  return (alerts ?? []).filter((a) => a.active && !a.resolved_at && !a.dismissed_at);
}

export function unreadProjectedFundsAlerts(alerts: ProjectedFundsAlert[] | undefined | null): ProjectedFundsAlert[] {
  return activeProjectedFundsAlerts(alerts).filter((a) => !a.read_at);
}

export function shouldPromptNotificationPermission(input: {
  hasFinancialData: boolean;
  alreadyAsked: boolean;
  pushPrefEnabled: boolean;
}): boolean {
  return input.hasFinancialData && !input.alreadyAsked && input.pushPrefEnabled;
}

export const NOTIFICATION_PERMISSION_COPY = {
  title: "Stay ahead of low balances",
  body: "FlowSight can warn you before a scheduled payment is projected to overdraw an account.",
  enable: "Enable notifications",
  notNow: "Not now",
} as const;

export type HouseholdRiskWarningKind = "negative" | "credit_limit";

export type HouseholdRiskWarning = {
  accountName: string;
  date: string;
  kind: HouseholdRiskWarningKind;
};

/**
 * Map server-authored projected-funds alerts onto Transactions summary warnings.
 * Does not inspect running_balance or reconstruct a ledger.
 */
export function householdRiskWarningsFromProjectedFundsAlerts(
  alerts: readonly ProjectedFundsAlert[] | undefined | null
): HouseholdRiskWarning[] {
  const warnings: HouseholdRiskWarning[] = [];
  for (const alert of activeProjectedFundsAlerts(alerts)) {
    if (alert.alert_type === "INSUFFICIENT_FUNDS") {
      warnings.push({
        accountName: alert.account_name,
        date: alert.occurrence_date,
        kind: "negative",
      });
    } else if (alert.alert_type === "CREDIT_LIMIT_RISK") {
      warnings.push({
        accountName: alert.account_name,
        date: alert.occurrence_date,
        kind: "credit_limit",
      });
    }
  }
  return warnings.sort((a, b) => a.date.localeCompare(b.date) || a.accountName.localeCompare(b.accountName));
}
