import { useEffect } from "react";

type Props = {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
};

export default function ActionToast({ message, onDismiss, durationMs = 4000 }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(t);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-sm px-4 py-2.5 rounded-lg bg-gray-900 text-white text-sm shadow-lg"
    >
      {message}
    </div>
  );
}
