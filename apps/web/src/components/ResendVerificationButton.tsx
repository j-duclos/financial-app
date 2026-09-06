import { useState } from "react";
import { resendVerification } from "@budget-app/api-client";

export default function ResendVerificationButton({ className }: { className?: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleResend() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await resendVerification();
      setMessage(result.detail);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Could not resend the email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className ?? "flex flex-wrap items-center gap-3"}>
      {message ? <p className="text-xs text-amber-900">{message}</p> : null}
      <button
        type="button"
        onClick={() => void handleResend()}
        disabled={busy}
        className="text-sm font-medium text-blue-700 hover:underline disabled:opacity-50"
      >
        {busy ? "Sending…" : "Resend verification email"}
      </button>
    </div>
  );
}
