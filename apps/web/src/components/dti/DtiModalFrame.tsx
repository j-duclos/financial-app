import { useEffect, type ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
};

export default function DtiModalFrame({ title, children, onClose, labelledBy }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center gap-3">
            <h2 id={labelledBy} className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-gray-500 hover:text-gray-800 min-h-[44px] min-w-[44px]"
            >
              Close
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-red-600" role="alert">
      {message}
    </p>
  );
}

export const fieldClass =
  "mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm min-h-[44px]";
