import type { DashboardInsight, DashboardInsightSeverity } from "@budget-app/shared";

export function insightSeverityIconClass(severity: DashboardInsightSeverity): string {
  switch (severity) {
    case "critical":
      return "text-red-600 bg-red-50";
    case "warning":
      return "text-amber-700 bg-amber-50";
    case "positive":
      return "text-green-700 bg-green-50";
    default:
      return "text-blue-700 bg-blue-50";
  }
}

export function insightSeverityLabel(severity: DashboardInsightSeverity): string {
  switch (severity) {
    case "critical":
      return "!";
    case "warning":
      return "⚠";
    case "positive":
      return "✓";
    default:
      return "i";
  }
}

/** User-facing label; normalizes legacy API copy. */
export function insightActionLabel(label: string | null): string | null {
  if (!label) return label;
  const trimmed = label.trim();
  if (/^(view timeline|view calendar|timeline|calendar)$/i.test(trimmed)) return "Open calendar";
  if (/^open timeline$/i.test(trimmed)) return "Open calendar";
  return label;
}

export function insightActionState(url: string | null): { accountId?: number } | undefined {
  if (!url) return undefined;
  const m = url.match(/[?&]account=(\d+)/);
  if (m) return { accountId: Number(m[1]) };
  const reconcile = url.match(/reconcile.*account=(\d+)/);
  if (reconcile) return { accountId: Number(reconcile[1]) };
  return undefined;
}

export function insightsEmptyMessage(): string {
  return "No urgent insights right now.";
}

export function insightsEmptySubtext(): string {
  return "All accounts look stable for the selected window.";
}
