type DashboardTimingMark =
  | "home-mounted"
  | "home-shell-rendered"
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

/** Development-only first-content timing for Dashboard progressive loading. */
export function markDashboardTiming(mark: DashboardTimingMark): void {
  if (!__DEV__) return;
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
