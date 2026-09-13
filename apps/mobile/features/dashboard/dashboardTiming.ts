import { markStartupEvent } from "@/lib/startupTrace";

type DashboardTimingMark =
  | "home-mounted"
  | "home-shell-rendered"
  | "home-accounts-visible"
  | "home-balances-visible"
  | "home-recent-activity-visible"
  | "home-forecast-visible"
  | "home-primary-content-visible"
  | "summary-fast-request-start"
  | "summary-fast-response"
  | "financial-health-rendered"
  | "attention-rendered"
  | "details-request-start"
  | "details-response"
  | "upcoming-rendered"
  | "goals-rendered"
  | "home-settled"
  /** First useful Home render complete — safe to start low-priority Transactions prefetch. */
  | "home-fully-useful"
  /** Extended cash risk query enabled (after details settle / idle, or cache HIT). */
  | "extended-risk-enabled";

const marks = new Map<DashboardTimingMark, number>();
let mountTime: number | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Maps Home section visibility to startup milestones.
 * `first_screen_ready` is reserved for meaningful financial data, not mount.
 */
export function markDashboardTiming(mark: DashboardTimingMark): void {
  if (mark === "home-shell-rendered") {
    markStartupEvent("home_shell_mounted");
  }
  if (mark === "home-accounts-visible") {
    markStartupEvent("home_accounts_visible");
  }
  if (mark === "home-balances-visible") {
    markStartupEvent("home_balances_visible");
  }
  if (mark === "home-recent-activity-visible") {
    markStartupEvent("home_recent_activity_visible");
  }
  if (mark === "home-forecast-visible") {
    markStartupEvent("home_forecast_visible");
  }
  if (mark === "home-primary-content-visible") {
    markStartupEvent("first_screen_ready");
    markStartupEvent("home_primary_content_visible");
  }
  if (mark === "home-fully-useful" || mark === "home-settled") {
    markStartupEvent("home_data_ready");
  }
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  if (mountTime == null) {
    mountTime = nowMs();
  }
  if (marks.has(mark)) return;
  marks.set(mark, nowMs());
  const elapsed = mountTime != null ? Math.round(nowMs() - mountTime) : 0;
  console.debug(`[dashboard-timing] ${mark} +${elapsed}ms`);
}

export function resetDashboardTimingForTests(): void {
  marks.clear();
  mountTime = null;
}

export function dashboardTimingSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [mark, time] of marks) {
    out[mark] = time;
  }
  return out;
}
