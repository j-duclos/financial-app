/** Above this absolute gap (and outside tolerance), show the critical state. */
export const RECONCILE_MISSING_THRESHOLD = 50;

export const RECONCILE_VARIANCE_TONES = ["balanced", "over_by", "under_by"] as const;
export type ReconcileVarianceTone = (typeof RECONCILE_VARIANCE_TONES)[number];

export type ReconcileVarianceDisplay = {
  emoji: string;
  label: string;
  amount: number;
  tone: ReconcileVarianceTone;
  severity: "warn" | "critical";
};

function signedVariance(
  difference: number,
  abs: number,
  severity: "warn" | "critical"
): ReconcileVarianceDisplay {
  const emoji = severity === "critical" ? "🔴" : "🟡";
  if (difference > 0) {
    return {
      emoji,
      label: "Over by",
      amount: abs,
      tone: "over_by",
      severity,
    };
  }
  return {
    emoji,
    label: "Under by",
    amount: abs,
    tone: "under_by",
    severity,
  };
}

export function reconcileVarianceDisplay(
  difference: number | null,
  options?: { tolerance?: number; missingThreshold?: number }
): ReconcileVarianceDisplay | null {
  if (difference == null || !Number.isFinite(difference)) return null;

  const tolerance = options?.tolerance ?? 0.01;
  const missingThreshold = options?.missingThreshold ?? RECONCILE_MISSING_THRESHOLD;
  const abs = Math.abs(difference);

  if (abs <= tolerance) {
    return {
      emoji: "🟢",
      label: "Balanced",
      amount: 0,
      tone: "balanced",
      severity: "warn",
    };
  }
  if (abs < missingThreshold) {
    return signedVariance(difference, abs, "warn");
  }
  return signedVariance(difference, abs, "critical");
}

/** Text color: green when balanced, amber for over / small gaps, red only for critical under. */
export function reconcileVarianceToneClass(
  tone: ReconcileVarianceTone,
  severity: ReconcileVarianceDisplay["severity"] = "warn"
): string {
  if (tone === "balanced") return "text-green-700";
  if (tone === "over_by") return "text-amber-700";
  if (severity === "critical") return "text-red-700";
  return "text-amber-700";
}
