type TransactionsPrefetchMark =
  | "prefetch-start"
  | "recent-prefetch-done"
  | "recent-prefetch-skipped"
  | "timeline-prefetch-done"
  | "timeline-prefetch-skipped"
  | "prefetch-complete";

const marks = new Map<string, number>();
let prefetchEpochStart: number | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Development-only timing for Home → Transactions background prefetch. */
export function markTransactionsPrefetchTiming(
  mark: TransactionsPrefetchMark,
  detail?: Record<string, string>
): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  if (mark === "prefetch-start") {
    prefetchEpochStart = nowMs();
    marks.clear();
  }
  const key = detail?.accountId ? `${mark}:${detail.accountId}` : mark;
  if (marks.has(key) && mark !== "prefetch-start") return;
  marks.set(key, nowMs());
  const elapsed =
    prefetchEpochStart != null ? Math.round(nowMs() - prefetchEpochStart) : 0;
  const extra = detail
    ? " " +
      Object.entries(detail)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
    : "";
  console.debug(`[transactions-prefetch-timing] ${mark} +${elapsed}ms${extra}`);
}

export function resetTransactionsPrefetchTimingForTests(): void {
  marks.clear();
  prefetchEpochStart = null;
}

export function transactionsPrefetchTimingSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [mark, time] of marks) {
    out[mark] = time;
  }
  return out;
}
