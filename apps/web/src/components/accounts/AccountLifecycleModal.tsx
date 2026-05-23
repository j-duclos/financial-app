import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getEffectiveDisplayName } from "@budget-app/shared";
import type { Account } from "@budget-app/shared";
import {
  archiveAccount,
  closeAccount,
  deleteAccount,
  getAccountLifecyclePreflight,
  restoreAccount,
  type AccountLifecyclePreflight,
} from "@budget-app/api-client";

export type LifecycleAction = "archive" | "close" | "delete" | "restore";

type Props = {
  account: Account | null;
  action: LifecycleAction | null;
  onClose: () => void;
  onSuccess: () => void;
};

const TITLES: Record<LifecycleAction, string> = {
  archive: "Archive account?",
  close: "Close account?",
  delete: "Delete account?",
  restore: "Restore account?",
};

const DESCRIPTIONS: Record<LifecycleAction, string> = {
  archive:
    "This account will be hidden from active views. Forecasting and Plaid sync stop. Transaction history is preserved.",
  close:
    "Marks the account as closed in real life. Future recurring and transfers stop. History is preserved.",
  delete:
    "Soft-deletes this account: it is hidden from normal lists. All transactions remain in your history.",
  restore: "Returns this account to active use. You can optionally re-enable Plaid sync and forecasting.",
};

export default function AccountLifecycleModal({ account, action, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState("");
  const [forceClose, setForceClose] = useState(false);
  const [reenablePlaid, setReenablePlaid] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: preflight } = useQuery({
    queryKey: ["account-lifecycle-preflight", account?.id, action],
    queryFn: () => getAccountLifecyclePreflight(account!.id, action!),
    enabled: !!account && !!action && action !== "restore",
  });

  useEffect(() => {
    setReason("");
    setForceClose(false);
    setReenablePlaid(false);
    setConfirmName("");
    setError(null);
  }, [account?.id, action]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!account || !action) return;
      if (action === "archive") {
        await archiveAccount(account.id, { reason: reason.trim() || undefined });
      } else if (action === "close") {
        await closeAccount(account.id, { reason: reason.trim() || undefined, force: forceClose });
      } else if (action === "delete") {
        await deleteAccount(account.id);
      } else {
        await restoreAccount(account.id, { reenable_plaid: reenablePlaid, reenable_forecast: true });
      }
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    },
    onError: (e: Error) => setError(e.message || "Request failed"),
  });

  if (!account || !action) return null;

  const displayName = getEffectiveDisplayName(account);
  const needsNameConfirm = action === "delete";
  const nameOk = !needsNameConfirm || confirmName.trim() === displayName.trim();
  const closeBlocked = action === "close" && preflight?.non_zero_balance && !forceClose;

  return (
    <ModalOverlay>
      <div
        className="bg-white rounded-lg p-6 max-w-md w-full shadow-lg border border-gray-200"
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-lg font-semibold text-gray-900 mb-2">{TITLES[action]}</h2>
        <p className="text-sm text-gray-700 mb-3">{DESCRIPTIONS[action]}</p>
        <p className="text-sm font-medium text-gray-900 mb-2">{displayName}</p>

        {preflight && action !== "restore" ? <PreflightWarnings data={preflight} /> : null}

        {action === "restore" ? (
          <label className="flex items-center gap-2 text-sm text-gray-700 mb-3">
            <input
              type="checkbox"
              checked={reenablePlaid}
              onChange={(e) => setReenablePlaid(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Re-enable Plaid sync
          </label>
        ) : (
          <label className="block text-sm text-gray-600 mb-2">
            Reason (optional)
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              maxLength={255}
            />
          </label>
        )}

        {action === "close" && preflight?.non_zero_balance ? (
          <label className="flex items-center gap-2 text-sm text-amber-800 mb-3">
            <input
              type="checkbox"
              checked={forceClose}
              onChange={(e) => setForceClose(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Close anyway (non-zero balance)
          </label>
        ) : null}

        {needsNameConfirm ? (
          <>
            <p className="text-sm text-gray-600 mb-2">
              Type <span className="font-mono bg-gray-100 px-1 rounded">{displayName}</span> to confirm:
            </p>
            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm mb-3"
              autoComplete="off"
            />
          </>
        ) : null}

        {error ? <p className="text-sm text-red-600 mb-3">{error}</p> : null}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            className="py-2 px-4 border border-gray-300 rounded text-sm hover:bg-gray-50"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`py-2 px-4 text-white rounded text-sm disabled:opacity-50 ${
              action === "delete" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
            disabled={mutation.isPending || !nameOk || closeBlocked}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Working…" : action === "restore" ? "Restore" : "Confirm"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function PreflightWarnings({ data }: { data: AccountLifecyclePreflight }) {
  if (!data.warnings?.length) return null;
  return (
    <ul className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-3 mb-3 list-disc pl-5 space-y-1">
      {data.warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

function ModalOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-30 px-4">
      {children}
    </div>
  );
}
