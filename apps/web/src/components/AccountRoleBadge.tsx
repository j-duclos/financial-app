import { getAccountRoleMeta } from "../lib/accountRoles";

type AccountRoleBadgeProps = {
  role: string | null | undefined;
  compact?: boolean;
  className?: string;
};

export function AccountRoleBadge({ role, compact = false, className = "" }: AccountRoleBadgeProps) {
  const meta = getAccountRoleMeta(role);
  const Icon = meta.icon;
  const sizeClass = compact ? "h-3 w-3" : "h-3.5 w-3.5";
  const layoutClass = compact
    ? "inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-tight"
    : "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-tight";

  return (
    <span
      className={`${layoutClass} ${meta.badgeClass} ${className}`.trim()}
      title={meta.description}
    >
      <Icon className={`${sizeClass} shrink-0`} aria-hidden />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}
