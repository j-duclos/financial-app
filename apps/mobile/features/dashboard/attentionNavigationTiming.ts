type AttentionNavigationMark =
  | "attention-tap"
  | "navigation-started"
  | "transactions-mounted"
  | "transactions-first-rows"
  | "transactions-first-network"
  | "transactions-timeline";

const marks = new Map<AttentionNavigationMark, number>();
let tapTime: number | null = null;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function markAttentionNavigation(mark: AttentionNavigationMark): void {
  if (!__DEV__) return;
  if (mark === "attention-tap") {
    tapTime = nowMs();
    marks.clear();
    marks.set(mark, tapTime);
    console.debug("[attention-nav-timing] attention-tap +0ms");
    return;
  }
  if (marks.has(mark)) return;
  marks.set(mark, nowMs());
  const elapsed = tapTime != null ? Math.round(nowMs() - tapTime) : 0;
  console.debug(`[attention-nav-timing] ${mark} +${elapsed}ms`);
}

export function resetAttentionNavigationTimingForTests(): void {
  marks.clear();
  tapTime = null;
}

export function attentionNavigationTimingSnapshot(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [mark, time] of marks) {
    out[mark] = time;
  }
  return out;
}
