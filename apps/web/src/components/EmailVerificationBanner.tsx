import { useState } from "react";
import { resendVerification } from "@budget-app/api-client";
import { useProfileQuery } from "../lib/profileQuery";

export default function EmailVerificationBanner() {
  const { data: profile } = useProfileQuery();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!profile?.email || profile.email_verified !== false) return null;

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
    <div
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 flex flex-wrap items-center justify-between gap-2"
      role="status"
      data-testid="email-verification-banner"
    >
      <p className="text-sm text-amber-950">Verify your email to protect your account.</p>
      <div className="flex items-center gap-3">
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
    </div>
  );
}
