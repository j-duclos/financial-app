import { formatCurrency } from "@budget-app/shared";
import {
  reconcileVarianceDisplay,
  reconcileVarianceToneClass,
  type ReconcileVarianceDisplay,
} from "../../lib/reconcileVarianceDisplay";

type Props = {
  difference: number | null;
  size?: "md" | "lg";
  className?: string;
};

function formatLine(display: ReconcileVarianceDisplay, currency = "USD"): string {
  return `${display.emoji} ${display.label} → ${formatCurrency(display.amount, currency)}`;
}

export default function ReconcileVarianceLine({
  difference,
  size = "md",
  className = "",
}: Props) {
  const display = reconcileVarianceDisplay(difference);
  if (!display) {
    return (
      <p className={`font-semibold tabular-nums text-gray-400 ${size === "lg" ? "text-2xl" : "text-lg"} ${className}`}>
        —
      </p>
    );
  }

  const textSize = size === "lg" ? "text-2xl" : "text-lg";
  return (
    <p
      className={`font-semibold tabular-nums ${textSize} ${reconcileVarianceToneClass(display.tone, display.severity)} ${className}`}
      title={formatLine(display)}
    >
      <span aria-hidden>{display.emoji} </span>
      {display.label} → {formatCurrency(display.amount)}
    </p>
  );
}

export function reconcileVarianceHint(
  difference: number | null,
  options?: { tolerance?: number }
): string {
  const display = reconcileVarianceDisplay(difference, options);
  if (!display) return "Enter bank balance to begin.";
  if (display.tone === "balanced") return "Matched — ready to complete.";
  if (display.severity === "critical") {
    return "Large gap — review unchecked transactions or add missing entries.";
  }
  return "Check transactions until this reaches $0.00.";
}
