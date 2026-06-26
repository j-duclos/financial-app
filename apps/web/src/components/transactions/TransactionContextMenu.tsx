import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

export type PastActions = "edit" | "duplicate" | "delete";
export type FutureActions = "edit" | "skip" | "delete";
export type ExpectedActions = "confirm" | "skip" | "edit" | "moveDate" | "match" | "delete";

type Props = {
  variant: "past" | "future" | "expected";
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSkip?: () => void;
  onConfirm?: () => void;
  onMoveDate?: () => void;
  onMatch?: () => void;
  /** When false, Match is hidden (no import candidates). */
  showMatch?: boolean;
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
  onConfirm,
  onMoveDate,
  onMatch,
  showMatch = true,
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

  const primaryItems: MenuItem[] =
    variant === "expected"
      ? ([
          onConfirm && { key: "confirm", label: "Confirm / Mark as Posted", action: onConfirm },
          onSkip && { key: "skip", label: "Skip", action: onSkip },
          onEdit && { key: "edit", label: "Edit", action: onEdit },
          onMoveDate && { key: "moveDate", label: "Move Date", action: onMoveDate },
          showMatch && onMatch && { key: "match", label: "Match to Import", action: onMatch },
        ].filter(Boolean) as MenuItem[])
      : variant === "past"
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

  const moreItems: MenuItem[] =
    variant === "expected" && onDelete
      ? [{ key: "delete", label: "Delete (advanced)", action: onDelete, danger: true }]
      : [];

  const items = [...primaryItems, ...moreItems];

  if (items.length === 0) return null;

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] min-w-[10rem] -translate-x-full rounded-md border border-gray-200 bg-white py-1 shadow-lg"
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            {primaryItems.map((item) => (
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
            {moreItems.length > 0 && primaryItems.length > 0 && (
              <div className="my-1 border-t border-gray-100" aria-hidden />
            )}
            {moreItems.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.action();
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-gray-50"
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
