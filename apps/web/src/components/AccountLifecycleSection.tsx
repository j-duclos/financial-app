import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  deleteUserAccount,
  downloadProfileExport,
  downloadTransactionsCsv,
  getDeleteAccountPreflight,
  type DeleteAccountPreflight,
} from "@budget-app/api-client";
import { useAuth } from "../context/AuthContext";
import ResendVerificationButton from "./ResendVerificationButton";

const inputClass = "mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white";
const secondaryButtonClass =
  "inline-flex items-center justify-center py-2 px-4 bg-white text-gray-800 text-sm font-medium rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50";
const DELETE_CONFIRMATION = "DELETE";

function ownerTransferMessage(reason: DeleteAccountPreflight["blocking_reasons"][number]): string {
  const name = reason.household_name?.trim() || "this household";
  return `You are the only owner of ${name}. Transfer ownership before deleting your account.`;
}

function blockingCopy(preflight: DeleteAccountPreflight): string[] {
  return preflight.blocking_reasons.map((reason) => {
    if (reason.code === "household_owner_transfer_required") {
      return ownerTransferMessage(reason);
    }
    if (reason.detail?.trim()) return reason.detail;
    if (reason.code === "email_verification_required") {
      return "Verify your email before deleting your account.";
    }
    return "Account deletion is blocked. Resolve the issue and try again.";
  });
}

export default function AccountLifecycleSection() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [exportMessage, setExportMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleteMessage, setDeleteMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const preflightQuery = useQuery({
    queryKey: ["delete-account-preflight"],
    queryFn: getDeleteAccountPreflight,
  });
  const preflight = preflightQuery.data;
  const blockers = preflight ? blockingCopy(preflight) : [];
  const canAttemptDelete = preflight?.can_delete === true;
  const needsEmailVerification = preflight?.blocking_reasons.some(
    (reason) => reason.code === "email_verification_required"
  );

  const jsonExportMu = useMutation({
    mutationFn: downloadProfileExport,
    onSuccess: () => setExportMessage({ type: "ok", text: "Download started." }),
    onError: (err: unknown) =>
      setExportMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Could not download your data.",
      }),
  });

  const csvExportMu = useMutation({
    mutationFn: downloadTransactionsCsv,
    onSuccess: () => setExportMessage({ type: "ok", text: "Download started." }),
    onError: (err: unknown) =>
      setExportMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Could not download transactions.",
      }),
  });

  const deleteMu = useMutation({
    mutationFn: () =>
      deleteUserAccount({
        current_password: currentPassword,
        confirmation,
      }),
    onSuccess: () => {
      navigate("/login", {
        replace: true,
        state: { message: "Your account has been deleted." },
      });
      logout();
    },
    onError: (err: unknown) => {
      setDeleteMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Could not delete your account.",
      });
    },
  });

  function handleDelete(e: FormEvent) {
    e.preventDefault();
    setDeleteMessage(null);
    if (!canAttemptDelete) return;
    if (confirmation.trim() !== DELETE_CONFIRMATION) {
      setDeleteMessage({ type: "err", text: "Type DELETE to confirm account deletion." });
      return;
    }
    if (!currentPassword) {
      setDeleteMessage({ type: "err", text: "Enter your current password." });
      return;
    }
    deleteMu.mutate();
  }

  return (
    <div className="space-y-6" data-testid="account-lifecycle-section">
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Your Data</h2>
        <p className="text-sm text-gray-600">
          Download a copy of the financial data available to your account.
        </p>
        {exportMessage ? (
          <p
            role="status"
            aria-live="polite"
            className={exportMessage.type === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"}
          >
            {exportMessage.text}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={jsonExportMu.isPending}
            onClick={() => {
              setExportMessage(null);
              jsonExportMu.mutate();
            }}
          >
            {jsonExportMu.isPending ? "Preparing…" : "Download my data"}
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={csvExportMu.isPending}
            onClick={() => {
              setExportMessage(null);
              csvExportMu.mutate();
            }}
          >
            {csvExportMu.isPending ? "Preparing…" : "Download transactions CSV"}
          </button>
        </div>
      </section>

      <section
        className="bg-white rounded-lg border border-red-200 shadow-sm p-6 sm:p-8 space-y-4"
        data-testid="danger-zone"
      >
        <h2 className="text-lg font-medium text-red-800">Danger Zone</h2>
        <p className="text-sm text-gray-700">Account deletion is permanent.</p>
        <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
          <li>Personal account data will be removed.</li>
          <li>Exclusively owned financial data may be removed.</li>
          <li>Shared household data may remain for other members.</li>
          <li>An active subscription will be canceled.</li>
          <li>Linked-bank access belonging exclusively to deleted data will be revoked.</li>
        </ul>
        {preflightQuery.isError ? (
          <p className="text-sm text-red-600" role="status">
            Could not check whether this account can be deleted. Try again later.
          </p>
        ) : null}
        {blockers.length > 0 ? (
          <div className="rounded border border-amber-200 bg-amber-50 p-3 space-y-2" role="status">
            {blockers.map((text) => (
              <p key={text} className="text-sm text-amber-950">
                {text}
              </p>
            ))}
            {needsEmailVerification ? <ResendVerificationButton /> : null}
          </div>
        ) : null}
        {deleteMessage ? (
          <p
            role="status"
            aria-live="polite"
            className={deleteMessage.type === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"}
          >
            {deleteMessage.text}
          </p>
        ) : null}
        <form onSubmit={handleDelete} className="space-y-4" autoComplete="off">
          <div>
            <label htmlFor="delete-account-password" className="block text-sm font-medium text-gray-700">
              Current password
            </label>
            <input
              id="delete-account-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="delete-account-confirmation" className="block text-sm font-medium text-gray-700">
              Type DELETE to confirm
            </label>
            <input
              id="delete-account-confirmation"
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={!canAttemptDelete || deleteMu.isPending}
            className="py-2 px-4 bg-red-700 text-white text-sm font-medium rounded hover:bg-red-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-red-600"
          >
            {deleteMu.isPending ? "Deleting…" : "Delete account"}
          </button>
        </form>
      </section>
    </div>
  );
}
