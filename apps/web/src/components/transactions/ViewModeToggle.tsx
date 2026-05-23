import type { ViewMode } from "./transactionsLedgerUtils";

type Props = {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
};

export default function ViewModeToggle({ viewMode, onChange }: Props) {
  return (
    <div
      className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-0.5"
      role="group"
      aria-label="View mode"
    >
      {(["timeline", "balance"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={`px-3 py-1 text-sm font-medium rounded-md capitalize transition-colors ${
            viewMode === mode ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
          }`}
          aria-pressed={viewMode === mode}
        >
          {mode}
        </button>
      ))}
    </div>
  );
}
