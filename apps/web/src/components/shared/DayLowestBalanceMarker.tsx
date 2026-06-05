import { AlertTriangle } from "lucide-react";
import {
  formatDashboardLowestMarker,
  formatTimelineLowestMarker,
  lowestMarkerAriaLabel,
  lowestMarkerIconClass,
  lowestMarkerSeverity,
  lowestMarkerTextClass,
  shouldShowLowestBalanceMarker,
  type DayLowestSource,
} from "../../lib/dayLowestBalanceDisplay";

type Props = {
  day: DayLowestSource;
  compact?: boolean;
  singleAccountView?: boolean;
  className?: string;
};

export default function DayLowestBalanceMarker({
  day,
  compact = false,
  singleAccountView = false,
  className = "",
}: Props) {
  if (!shouldShowLowestBalanceMarker(day)) return null;

  const text = compact
    ? formatDashboardLowestMarker(day)
    : formatTimelineLowestMarker(day, { singleAccountView });
  if (!text) return null;

  const severity = lowestMarkerSeverity(day);
  const aria = lowestMarkerAriaLabel(day);

  return (
    <p
      className={`text-xs flex items-start gap-1 pl-5 ${lowestMarkerTextClass(severity)} ${className}`}
      role="note"
      aria-label={aria ?? undefined}
    >
      <AlertTriangle
        className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${lowestMarkerIconClass(severity)}`}
        aria-hidden
      />
      <span>
        <span className="sr-only">Lowest projected balance: </span>
        {text}
      </span>
    </p>
  );
}
