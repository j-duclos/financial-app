import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onGetStarted: () => void;
  onSkip: () => void;
  skipPending?: boolean;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function OnboardingWelcomeModal({
  open,
  onGetStarted,
  onSkip,
  skipPending = false,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button")?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onSkip();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute("disabled")
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus();
    };
  }, [open, onSkip]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="onboarding-welcome"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSkip();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-welcome-title"
        className="max-w-md w-full rounded-lg bg-white p-6 shadow-xl space-y-4"
        tabIndex={-1}
      >
        <h2 id="onboarding-welcome-title" className="text-xl font-semibold text-gray-900">
          See your money before it happens.
        </h2>
        <p className="text-sm text-gray-700">
          Add your accounts, recurring income, and bills so Financial App can project your future
          balances.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            className="py-2 px-4 rounded border border-gray-300 text-sm font-medium text-gray-800 hover:bg-gray-50"
            onClick={onSkip}
            disabled={skipPending}
            aria-label="Skip onboarding for now"
          >
            Skip for now
          </button>
          <button
            type="button"
            className="py-2 px-4 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            onClick={onGetStarted}
          >
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}
