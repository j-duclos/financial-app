import type { LucideIcon } from "lucide-react";

type Props = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tooltip?: string;
  badge?: number;
  variant?: "primary" | "ghost";
  showLabel?: boolean;
  className?: string;
};

export default function QuickActionButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  loading,
  tooltip,
  badge,
  variant = "primary",
  showLabel = true,
  className = "",
}: Props) {
  const base =
    variant === "primary"
      ? "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 shadow-sm hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50"
      : "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={tooltip ?? label}
      aria-label={label}
      className={`${base} touch-manipulation relative ${className}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {showLabel ? <span className="truncate max-w-[8rem] sm:max-w-none">{label}</span> : null}
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center bg-white/80 rounded-md">
          <span className="h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        </span>
      ) : null}
      {badge != null && badge > 0 ? (
        <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-amber-600 text-white text-[10px] font-semibold flex items-center justify-center">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}
