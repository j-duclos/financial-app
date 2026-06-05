import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export type PastActions = "edit" | "duplicate" | "delete";
export type FutureActions = "edit" | "skip" | "delete";

type Props = {
  variant: "past" | "future";
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSkip?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
};

type MenuItem = { key: string; label: string; action: () => void; danger?: boolean };

export default function TransactionContextMenu({
  variant,
  onEdit,
  onDuplicate,
  onDelete,
  onSkip,
  disabled,
  readOnly,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, left: rect.right });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (readOnly) {
    return <span className="text-xs text-amber-700">Projected</span>;
  }

  const items: MenuItem[] =
    variant === "past"
      ? ([
          onEdit && { key: "edit", label: "Edit", action: onEdit },
          onDuplicate && { key: "duplicate", label: "Duplicate", action: onDuplicate },
          onDelete && { key: "delete", label: "Delete", action: onDelete, danger: true },
        ].filter(Boolean) as MenuItem[])
      : ([
          onEdit && { key: "edit", label: "Edit", action: onEdit },
          onSkip && { key: "skip", label: "Skip", action: onSkip },
          onDelete && { key: "delete", label: "Delete", action: onDelete, danger: true },
        ].filter(Boolean) as MenuItem[]);

  if (items.length === 0) return null;

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] min-w-[8rem] -translate-x-full rounded-md border border-gray-200 bg-white py-1 shadow-lg"
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.action();
                }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${
                  item.danger ? "text-red-600" : "text-gray-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        disabled={disabled}
        className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-50"
        aria-label="Transaction actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {menu}
    </>
  );
}
