import {
  normalizeSeverity,
  severityShowsAlert,
  severityTokens,
  type SeverityLevel,
} from "../../lib/severity";

type Props = {
  severity: string | null | undefined;
  /** Override normalized level when already known */
  level?: SeverityLevel;
  compact?: boolean;
  className?: string;
};

/** Shared severity pill — hidden for healthy. */
export default function SeverityBadge({
  severity,
  level,
  compact = false,
  className = "",
}: Props) {
  const resolved = level ?? normalizeSeverity(severity);
  if (!severityShowsAlert(resolved)) return null;

  const { label, badgeClass } = severityTokens(resolved);
  const size = compact
    ? "px-1.5 py-0.5 text-[10px]"
    : "px-2 py-0.5 text-xs";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded font-semibold uppercase tracking-wide ${size} ${badgeClass} ${className}`}
    >
      {label}
    </span>
  );
}
