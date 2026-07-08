import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import HoverTooltip from "../HoverTooltip";

type Props = {
  label: string;
  value: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  help?: string;
  valueClassName?: string;
  /** Hero tile for Spending Cushion — larger type, stronger border. */
  hero?: boolean;
  /** Secondary row tiles — slightly muted. */
  muted?: boolean;
};

export default function DashboardMetricTile({
  label,
  value,
  subtitle,
  badge,
  help,
  valueClassName = "text-gray-900",
  hero = false,
  muted = false,
}: Props) {
  const shell = hero
    ? "rounded-xl border-2 border-blue-200 bg-white px-2.5 py-2 sm:px-3 sm:py-2.5 min-h-[4.5rem] h-full shadow-md ring-1 ring-blue-100/80"
    : muted
      ? "rounded-lg border border-gray-200 bg-gray-50/80 px-2.5 py-2 sm:px-3 sm:py-2.5 min-h-[4.5rem] h-full shadow-sm"
      : "rounded-lg border border-gray-200 bg-white px-2.5 py-2 sm:px-3 sm:py-2.5 min-h-[4.5rem] h-full shadow-sm";

  const labelClass = hero
    ? "text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-gray-600 truncate"
    : "text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-gray-500 truncate";

  const valueClass = `text-base sm:text-lg md:text-xl lg:text-2xl font-bold tabular-nums leading-tight ${valueClassName}`;

  return (
    <div className={`flex flex-col justify-between ${shell}`}>
      <div className="flex items-start justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <p className={labelClass}>{label}</p>
          {help ? (
            <HoverTooltip label={help}>
              <HelpCircle
                className="h-3.5 w-3.5 shrink-0 text-gray-400 hover:text-gray-600"
                aria-hidden
              />
            </HoverTooltip>
          ) : null}
        </div>
        {badge}
      </div>
      <div>
        <p className={valueClass}>{value}</p>
        {subtitle ? (
          <div
            className={`mt-0.5 text-[10px] sm:text-xs line-clamp-2 ${muted ? "text-gray-500" : "text-gray-600"}`}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
