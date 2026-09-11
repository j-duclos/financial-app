import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activeProjectedFundsAlerts,
  parseProjectedFundsAlertId,
  projectedFundsForecastPath,
  projectedFundsLedgerPath,
  type ProjectedFundsAlert,
} from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const bannerSource = readFileSync(join(dir, "ProjectedFundsAlertBanner.tsx"), "utf8");
const listSource = readFileSync(join(dir, "ProjectedFundsActionList.tsx"), "utf8");
const layoutSource = readFileSync(join(dir, "Layout.tsx"), "utf8");
const actionCenterSource = readFileSync(join(dir, "../pages/ActionCenter.tsx"), "utf8");
const profileSource = readFileSync(join(dir, "../pages/Profile.tsx"), "utf8");

function sampleAlert(overrides: Partial<ProjectedFundsAlert> = {}): ProjectedFundsAlert {
  return {
    id: 9,
    household: 1,
    account: 3,
    account_name: "Main Checking",
    transaction: 44,
    rule: null,
    occurrence_date: "2026-09-10",
    fingerprint: "1:3:txn:44:2026-09-10",
    alert_type: "INSUFFICIENT_FUNDS",
    severity: "AT_RISK",
    amount: "494.00",
    projected_balance_before: "382.00",
    projected_balance_after: "-112.00",
    shortfall: "112.00",
    shortfall_display: "$112",
    payee: "Rent",
    title: "Payment may overdraw Main Checking",
    body: "$494 is scheduled for Sep 10. FlowSight projects a $382 balance before the payment.",
    banner_message: "Upcoming payment may overdraw Main Checking",
    active: true,
    first_detected_at: "2026-09-07T00:00:00Z",
    last_evaluated_at: "2026-09-07T00:00:00Z",
    resolved_at: null,
    dismissed_at: null,
    read_at: null,
    ...overrides,
  };
}

describe("Projected funds web surfaces", () => {
  it("shows a layout banner once, not a modal on every route", () => {
    expect(layoutSource).toMatch(/ProjectedFundsAlertBanner/);
    expect(bannerSource).toMatch(/sessionStorage/);
    expect(bannerSource).toMatch(/listProjectedFundsAlerts/);
    expect(bannerSource).not.toMatch(/projected_balance_before\s*<\s*/);
    expect(bannerSource).not.toMatch(/build_forecast_projection_timeline/);
  });

  it("detail actions include ledger, forecast, and dismiss with backend numbers", () => {
    expect(bannerSource).toMatch(/View in ledger/);
    expect(bannerSource).toMatch(/View forecast/);
    expect(bannerSource).toMatch(/projected_balance_before/);
    expect(bannerSource).toMatch(/shortfall_display/);
    expect(bannerSource).toMatch(/dismissed: true/);
    expect(projectedFundsLedgerPath(sampleAlert())).toBe(
      "/transactions?account=3&date=2026-09-10&focus=upcoming"
    );
    expect(projectedFundsForecastPath(sampleAlert())).toBe("/accounts?account=3");
  });

  it("Action Center lists the same server alerts", () => {
    expect(actionCenterSource).toMatch(/ProjectedFundsActionList/);
    expect(listSource).toMatch(/listProjectedFundsAlerts/);
    expect(listSource).not.toMatch(/getRecommendations/);
  });

  it("hides resolved and dismissed alerts from active lists", () => {
    const alerts = [
      sampleAlert(),
      sampleAlert({ id: 10, active: false, resolved_at: "2026-09-08T00:00:00Z" }),
      sampleAlert({ id: 11, active: false, dismissed_at: "2026-09-08T00:00:00Z" }),
    ];
    expect(activeProjectedFundsAlerts(alerts).map((a) => a.id)).toEqual([9]);
  });

  it("parses Action Center deep links", () => {
    expect(parseProjectedFundsAlertId(new URLSearchParams("alert=9"))).toBe(9);
    expect(parseProjectedFundsAlertId({ alert: "nope" })).toBeNull();
  });

  it("exposes notification preferences on Profile", () => {
    expect(profileSource).toMatch(/AlertsPreferencesSection/);
    expect(profileSource).toMatch(/projected_funds_web_alerts/);
    expect(profileSource).toMatch(/projected_funds_push_enabled/);
    expect(profileSource).toMatch(/notify_3_days_before/);
  });
});

describe("householdRiskWarningsFromProjectedFundsAlerts", () => {
  it("maps canonical alert types without inspecting running_balance", async () => {
    const { householdRiskWarningsFromProjectedFundsAlerts } = await import("@budget-app/shared");
    const warnings = householdRiskWarningsFromProjectedFundsAlerts([
      sampleAlert(),
      sampleAlert({
        id: 10,
        account_name: "Savor",
        alert_type: "CREDIT_LIMIT_RISK",
        occurrence_date: "2026-09-12",
      }),
      sampleAlert({ id: 11, active: false, occurrence_date: "2026-09-01" }),
    ]);
    expect(warnings).toEqual([
      { accountName: "Main Checking", date: "2026-09-10", kind: "negative" },
      { accountName: "Savor", date: "2026-09-12", kind: "credit_limit" },
    ]);
  });
});
