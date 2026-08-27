type AccountsTimingMark =
  | "accounts-mounted"
  | "basic-account-data-visible"
  | "enriched-statuses-visible"
  | "detail-mounted"
  | "basic-detail-visible"
  | "forecast-enrichment-visible"
  | "recent-preview-visible"
  | "upcoming-preview-visible";

const marks = new Map<AccountsTimingMark, number>();
let mountTime: number | null = null;
let scope: "list" | "detail" | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function ensureMount(nextScope: "list" | "detail"): void {
  if (scope !== nextScope) {
    marks.clear();
    mountTime = null;
    scope = nextScope;
  }
  if (mountTime == null) {
    mountTime = nowMs();
  }
}

/** Development-only timing for Accounts list / Account Detail progressive loading. */
export function markAccountsTiming(
  mark: AccountsTimingMark,
  nextScope: "list" | "detail" = mark.startsWith("detail") ||
    mark.includes("preview") ||
    mark.includes("forecast") ||
    mark.includes("basic-detail")
    ? "detail"
    : "list"
): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return;
  ensureMount(nextScope);
  if (marks.has(mark)) return;
  marks.set(mark, nowMs());
  const elapsed = mountTime != null ? Math.round(nowMs() - mountTime) : 0;
  console.debug(`[accounts-timing] ${mark} +${elapsed}ms`);
}

export function resetAccountsTimingForTests(): void {
  marks.clear();
  mountTime = null;
  scope = null;
}

export function accountsTimingSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [mark, time] of marks) {
    out[mark] = time;
  }
  return out;
}
