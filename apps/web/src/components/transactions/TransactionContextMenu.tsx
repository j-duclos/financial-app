import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export type PastActions = "edit" | "duplicate" | "delete";
export type FutureActions = "edit" | "skip" | "move" | "delete";

type Props = {
  variant: "past" | "future";
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onSkip?: () => void;
  onMove?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
};

export default function TransactionContextMenu({
  variant,
  onEdit,
  onDuplicate,
  onDelete,
  onSkip,
  onMove,
  disabled,
  readOnly,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (readOnly) {
    return <span className="text-xs text-amber-700">Projected</span>;
  }

  const items =
    variant === "past"
      ? ([
          onEdit && { key: "edit", label: "Edit", action: onEdit },
          onDuplicate && { key: "duplicate", label: "Duplicate", action: onDuplicate },
          onDelete && { key: "delete", label: "Delete", action: onDelete, danger: true },
        ].filter(Boolean) as { key: string; label: string; action: () => void; danger?: boolean }[])
      : ([
          onEdit && { key: "edit", label: "Edit", action: onEdit },
          onSkip && { key: "skip", label: "Skip", action: onSkip },
          onMove && { key: "move", label: "Move", action: onMove },
          onDelete && { key: "delete", label: "Delete", action: onDelete, danger: true },
        ].filter(Boolean) as { key: string; label: string; action: () => void; danger?: boolean }[]);

  if (items.length === 0) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-50"
        aria-label="Transaction actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 min-w-[8rem] rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
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
        </div>
      )}
    </div>
  );
}
