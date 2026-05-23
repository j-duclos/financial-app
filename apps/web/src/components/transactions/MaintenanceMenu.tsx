import { useEffect, useRef, useState } from "react";
import { Wrench } from "lucide-react";

type Props = {
  onCleanupOrphans: () => void;
  cleanupPending: boolean;
  orphanMessage: string | null;
  onDismissMessage: () => void;
};

export default function MaintenanceMenu({
  onCleanupOrphans,
  cleanupPending,
  orphanMessage,
  onDismissMessage,
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        aria-expanded={open}
      >
        <Wrench className="w-4 h-4" />
        Maintenance
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <p className="text-xs text-gray-600 mb-3">
            Remove future dated rows left after a recurring rule was deleted. Past transactions are not removed.
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onCleanupOrphans();
            }}
            disabled={cleanupPending}
            className="w-full rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 hover:bg-amber-100 disabled:opacity-50"
          >
            {cleanupPending ? "Cleaning…" : "Remove orphaned rule projections"}
          </button>
        </div>
      )}
      {orphanMessage && (
        <div
          className={`absolute right-0 top-full z-30 mt-1 w-80 rounded border p-2 text-xs shadow ${
            orphanMessage.startsWith("Removed") || orphanMessage.startsWith("No orphaned")
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-amber-50 border-amber-200 text-amber-950"
          }`}
        >
          <div className="flex justify-between gap-2">
            <span>{orphanMessage}</span>
            <button type="button" onClick={onDismissMessage} className="shrink-0 hover:underline">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
