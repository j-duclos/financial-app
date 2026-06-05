import { monthAriaLabelFromKey } from "../../lib/monthGroupDisplay";

type Props = {
  monthKey: string;
  label: string;
  /** When false, renders a static separator (no sticky positioning). */
  sticky?: boolean;
  /** Shorter padding for dashboard upcoming. */
  compact?: boolean;
  /** Sticky top offset class, e.g. top-0 or top-10 */
  stickyTopClass?: string;
  className?: string;
};

export default function StickyMonthHeader({
  monthKey,
  label,
  sticky = true,
  compact = false,
  stickyTopClass = "top-0",
  className = "",
}: Props) {
  const aria = monthAriaLabelFromKey(monthKey);

  return (
    <h2
      className={[
        sticky ? `sticky ${stickyTopClass} z-20` : "",
        "bg-white/95 backdrop-blur-sm border-b border-gray-200",
        compact ? "px-2 py-1 -mx-1" : "px-3 py-2",
        "text-[10px] sm:text-xs font-semibold tracking-wide text-gray-500 uppercase",
        "shrink-0",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={aria}
    >
      {label}
    </h2>
  );
}
