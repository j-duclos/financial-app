import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  labelledBy: string;
  /** When true, Escape and backdrop click do not close the dialog. */
  busy?: boolean;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true"
  );
}

export default function DtiModalFrame({ title, children, onClose, labelledBy, busy = false }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  onCloseRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const firstField = dialog.querySelector<HTMLElement>("input, select, textarea");
    (firstField ?? dialog).focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const nodes = focusableElements(dialogRef.current);
      if (nodes.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (busyRef.current) return;
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto outline-none"
      >
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center gap-3">
            <h2 id={labelledBy} className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            <button
              type="button"
              onClick={() => {
                if (!busyRef.current) onCloseRef.current();
              }}
              disabled={busy}
              aria-label="Close dialog"
              className="text-sm text-gray-500 hover:text-gray-800 min-h-[44px] min-w-[44px] disabled:opacity-50"
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

/** Label text stays independent of the error so aria-describedby can point at the message. */
export function DtiFieldShell({
  id,
  label,
  errorId,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  errorId: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="block text-sm">
      <label htmlFor={id} className="text-gray-700">
        {label}
      </label>
      {children}
      {hint ? (
        <span id={`${id}-hint`} className="mt-1 block text-xs text-gray-500">
          {hint}
        </span>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function describedByIds(
  error: string | undefined,
  errorId: string,
  hintId?: string
): string | undefined {
  const ids = [error ? errorId : null, hintId ?? null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}
