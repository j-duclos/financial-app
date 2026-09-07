import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BillingStatus } from "@budget-app/shared";
import {
  clampForecastDaysForPlan,
  isForecastDaysAllowed,
} from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(dir, "../..");

function read(rel: string): string {
  return readFileSync(join(mobileRoot, rel), "utf8");
}

const screen = read("features/calendar/CalendarScreen.tsx");
const data = read("features/calendar/useCalendarData.ts");
const filters = read("features/calendar/CalendarFiltersSheet.tsx");
const summary = read("features/calendar/CalendarDaySummary.tsx");
const banner = read("features/calendar/CalendarNextRiskBanner.tsx");
const webCalendar = readFileSync(
  join(mobileRoot, "../web/src/pages/Timeline.tsx"),
  "utf8"
);

const freeBilling: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
  entitlements: {
    plan: "FREE",
    is_premium: false,
    plaid_bank_sync: false,
    payment_planner_full: false,
    limits: {
      linked_institutions: 0,
      manual_accounts: 3,
      recurring_rules: 10,
      operational_forecast_days: 90,
      goals: 2,
    },
    usage: {
      linked_institutions: 0,
      manual_accounts: 0,
      recurring_rules: 0,
      goals: 0,
    },
  },
};

const premiumBilling: BillingStatus = {
  ...freeBilling,
  plan: "PREMIUM",
  is_premium: true,
  status: "active",
  entitlements: {
    plan: "PREMIUM",
    is_premium: true,
    plaid_bank_sync: true,
    payment_planner_full: true,
    limits: {
      linked_institutions: null,
      manual_accounts: null,
      recurring_rules: null,
      operational_forecast_days: 365,
      goals: null,
    },
    usage: {
      linked_institutions: 1,
      manual_accounts: 4,
      recurring_rules: 11,
      goals: 3,
    },
  },
};

describe("mobile Calendar companion query behavior", () => {
  it("loads summary plus the visible month chunk only", () => {
    expect(data).toMatch(/getTimelineCalendarSummary/);
    expect(data).toMatch(/getTimelineCalendarChunk/);
    expect(data).toMatch(/chunkWindowForMonth/);
    expect(data).toMatch(/staleTime: 60_000/);
    expect(data).not.toMatch(/getTimeline\(/);
    expect(data).not.toMatch(/prefetchMonth/);
    expect(data).not.toMatch(/prefetchAdjacent/);
  });

  it("refreshes summary and visible chunk concurrently", () => {
    expect(data).toMatch(/Promise\.all/);
    expect(data).toMatch(/summaryQuery\.refetch/);
    expect(data).toMatch(/visibleChunkQuery\.refetch/);
  });

  it("lazy-loads account options", () => {
    expect(screen).toMatch(/enabled: filtersOpen \|\| accountId !== ""/);
  });

  it("does not add a second ending-balance request", () => {
    expect(summary).toMatch(/resolved\.ending_balance/);
    expect(summary).not.toMatch(/getTimeline\(/);
    expect(summary).not.toMatch(/getTransaction\(/);
    expect(data).not.toMatch(/ending_balance/);
  });
});

describe("mobile Calendar companion entitlements", () => {
  it("reuses the shared plan-aware forecast window", () => {
    expect(screen).toMatch(/usePageForecastWindow/);
    expect(screen).not.toMatch(/operational_forecast_days/);
    expect(isForecastDaysAllowed(365, freeBilling)).toBe(false);
    expect(clampForecastDaysForPlan(365, freeBilling)).toBe(90);
    expect(isForecastDaysAllowed(365, premiumBilling)).toBe(true);
  });

  it("disables month navigation outside the loaded range", () => {
    expect(screen).toMatch(/disabled=\{!prevMonthInRange\}/);
    expect(screen).toMatch(/disabled=\{!nextMonthInRange\}/);
    expect(screen).toMatch(/Outside forecast window/);
    expect(screen).toMatch(/Before history window/);
  });
});

describe("mobile Calendar companion chrome", () => {
  it("keeps core mobile calendar structure and sheet filters", () => {
    expect(screen).toMatch(/Calendar/);
    expect(screen).toMatch(/CalendarNextRiskBanner/);
    expect(screen).toMatch(/Go to today/);
    expect(screen).toMatch(/CalendarMonthGrid/);
    expect(screen).toMatch(/CalendarDaySummary/);
    expect(filters).toMatch(/All accounts/);
    expect(filters).toMatch(/Recurring only/);
    expect(filters).not.toMatch(/scenario/);
    expect(filters).not.toMatch(/lookback/);
    expect(screen).not.toMatch(/Safe Until Next Income/);
    expect(screen).not.toMatch(/Accounts to watch/);
  });

  it("navigates the shortfall banner to the account ledger focus", () => {
    expect(banner).toMatch(/transactionsForForecastRiskPath/);
    expect(banner).not.toMatch(/setSelectedDate/);
  });
});

describe("web Calendar remains desktop-oriented", () => {
  it("does not strip web calendar workspace controls", () => {
    expect(webCalendar).toMatch(/Accounts to watch/);
    expect(webCalendar).toMatch(/lookbackMonths/);
    expect(webCalendar).toMatch(/scenario/);
    expect(webCalendar.length).toBeGreaterThan(1000);
  });
});
