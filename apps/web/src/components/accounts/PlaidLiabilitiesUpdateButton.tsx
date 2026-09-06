import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { createPlaidUpdateModeLinkToken, syncPlaidItemLiabilities } from "@budget-app/api-client";
import { getPlaidRedirectUri } from "../../lib/plaidRedirectUri";
import {
  clearPendingUpdateMode,
  persistPendingUpdateMode,
} from "../../lib/plaidUpdateModeSession";

type PlaidExitError = { error_message?: string; error_code?: string; display_message?: string };

function UpdateModeHost({
  linkToken,
  onFinished,
  onError,
}: {
  linkToken: string;
  onFinished: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const openedRef = useRef<string | null>(null);
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: () => {
      void onFinished();
    },
    onExit: (err: PlaidExitError | null) => {
      if (err && (err.error_message || err.display_message || err.error_code)) {
        onError([err.display_message, err.error_message, err.error_code].filter(Boolean).join(" — "));
      }
      clearPendingUpdateMode();
    },
  });

  useEffect(() => {
    if (!linkToken || !ready) return;
    if (openedRef.current === linkToken) return;
    openedRef.current = linkToken;
    open();
  }, [linkToken, ready, open]);

  return null;
}

export function PlaidLiabilitiesUpdateButton({
  itemId,
  disabled = false,
  onComplete,
}: {
  itemId: number;
  disabled?: boolean;
  onComplete: () => Promise<void> | void;
}) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(async () => {
    try {
      await syncPlaidItemLiabilities(itemId);
      clearPendingUpdateMode();
      setLinkToken(null);
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh minimums after updating the connection.");
    } finally {
      setBusy(false);
    }
  }, [itemId, onComplete]);

  async function startUpdate() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const redirect_uri = getPlaidRedirectUri();
      const { link_token } = await createPlaidUpdateModeLinkToken(itemId, { redirect_uri });
      persistPendingUpdateMode(link_token, itemId);
      setLinkToken(link_token);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Could not start the bank-connection update.");
    }
  }

  return (
    <div className="space-y-1">
      {linkToken ? (
        <UpdateModeHost
          key={linkToken}
          linkToken={linkToken}
          onFinished={finish}
          onError={(message) => {
            setBusy(false);
            setError(message);
            setLinkToken(null);
          }}
        />
      ) : null}
      <button
        type="button"
        className="rounded border border-blue-300 bg-white px-3 py-1 text-sm text-blue-800 min-h-[44px]"
        onClick={() => void startUpdate()}
        disabled={disabled || busy}
      >
        {busy ? "Opening bank update…" : "Enable credit-card minimum updates"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
