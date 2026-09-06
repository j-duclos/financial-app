import { EMAIL_VERIFICATION_REQUIRED_MESSAGE, PLAID_PREMIUM_MESSAGE } from "../../lib/billing";
import ResendVerificationButton from "../ResendVerificationButton";

const primaryButtonClass =
  "inline-flex items-center justify-center py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500";

export default function PremiumUpgradePrompt({
  title = PLAID_PREMIUM_MESSAGE,
  description,
  onUpgrade,
  busy = false,
  error,
  verificationRequired = false,
}: {
  title?: string;
  description?: string;
  onUpgrade: () => void;
  busy?: boolean;
  error?: string | null;
  verificationRequired?: boolean;
}) {
  return (
    <div
      className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 space-y-2"
      role="status"
      data-testid="premium-upgrade-prompt"
    >
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {description ? <p className="text-sm text-gray-700">{description}</p> : null}
      {verificationRequired ? (
        <div className="space-y-2" data-testid="checkout-email-verification-required">
          <p className="text-sm text-red-700" role="alert">
            {EMAIL_VERIFICATION_REQUIRED_MESSAGE}
          </p>
          <ResendVerificationButton />
        </div>
      ) : error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={primaryButtonClass}
        onClick={onUpgrade}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {busy ? "Opening checkout…" : "Upgrade to Premium"}
      </button>
    </div>
  );
}
