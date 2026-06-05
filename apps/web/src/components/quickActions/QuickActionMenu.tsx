import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import type { QuickActionDef } from "../../lib/accountQuickActions";
import QuickActionButton from "./QuickActionButton";

type Props = {
  actions: QuickActionDef[];
  dangerActions?: QuickActionDef[];
  onAction: (action: QuickActionDef) => void;
  disabled?: boolean;
  menuLabel?: string;
};

function placeMenu(container: HTMLElement, menu: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 4;

  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  const openUp = spaceBelow < menuRect.height && spaceAbove > spaceBelow;

  const top = openUp
    ? Math.max(margin, rect.top - menuRect.height - margin)
    : rect.bottom + margin;

  const left = Math.max(
    margin,
    Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - margin)
  );

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

export default function QuickActionMenu({
  actions,
  dangerActions = [],
  onAction,
  disabled,
  menuLabel = "More actions",
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const menu = menuRef.current;
    const container = containerRef.current;
    if (!menu || !container) return;

    const update = () => {
      if (menuRef.current && containerRef.current) {
        placeMenu(containerRef.current, menuRef.current);
      }
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, actions.length, dangerActions.length]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (actions.length === 0 && dangerActions.length === 0) return null;

  const renderItem = (action: QuickActionDef) => (
    <button
      key={`${action.id}-${action.label}`}
      type="button"
      role="menuitem"
      disabled={action.disabled}
      title={action.tooltip ?? action.label}
      className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm touch-manipulation disabled:opacity-50 ${
        action.danger
          ? "text-red-700 hover:bg-red-50"
          : "text-gray-800 hover:bg-gray-50"
      }`}
      onClick={() => {
        setOpen(false);
        onAction(action);
      }}
    >
      <action.icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
      <span className="flex-1 truncate">{action.label}</span>
      {action.badge != null && action.badge > 0 ? (
        <span className="shrink-0 rounded-full bg-amber-100 text-amber-900 text-[10px] font-medium px-1.5 py-0.5">
          {action.badge}
        </span>
      ) : null}
    </button>
  );

  const menu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: 0, left: 0 }}
            className="z-50 min-w-[12rem] max-w-[18rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-[min(70vh,24rem)] overflow-y-auto"
          >
            {actions.map(renderItem)}
            {dangerActions.length > 0 && actions.length > 0 ? (
              <div className="my-1 border-t border-gray-200" role="separator" />
            ) : null}
            {dangerActions.length > 0 ? (
              <div role="group" aria-label="Danger zone">
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-600">
                  Danger zone
                </p>
                {dangerActions.map(renderItem)}
              </div>
            ) : null}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={containerRef} className="relative">
      <QuickActionButton
        label={menuLabel}
        icon={MoreHorizontal}
        variant="ghost"
        showLabel={false}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="!px-2.5 !py-2"
      />
      {menu}
    </div>
  );
}
