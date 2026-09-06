import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { changeEmail } from "@budget-app/api-client";
import { useAuth } from "../context/AuthContext";
import { PROFILE_QUERY_KEY, useProfileQuery } from "../lib/profileQuery";
import ResendVerificationButton from "./ResendVerificationButton";

const inputClass = "mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white";
const readOnlyClass = `${inputClass} bg-gray-50 text-gray-600 cursor-default`;
const secondaryButtonClass =
  "inline-flex items-center justify-center py-2 px-4 bg-white text-gray-800 text-sm font-medium rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50";
const primaryButtonClass =
  "inline-flex items-center justify-center py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50";

export default function ChangeEmailSection() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const { data: profile } = useProfileQuery();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const hasEmail = Boolean(profile?.email?.trim());
  const verified = profile?.email_verified === true;

  const changeMu = useMutation({
    mutationFn: () =>
      changeEmail({
        email: email.trim(),
        current_password: currentPassword,
      }),
    onSuccess: async (result) => {
      setMessage({ type: "ok", text: "Email updated. Check your new address to verify it." });
      setOpen(false);
      setEmail("");
      setCurrentPassword("");
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
      await refreshUser();
      if (result.email) {
        queryClient.setQueryData(PROFILE_QUERY_KEY, (prev: unknown) =>
          prev && typeof prev === "object"
            ? { ...prev, email: result.email, email_verified: result.email_verified }
            : prev
        );
      }
    },
    onError: (err: unknown) => {
      setMessage({
        type: "err",
        text: err instanceof Error ? err.message : "Could not update email.",
      });
    },
  });

  if (!profile) return null;

  return (
    <div data-testid="change-email-section">
      <label htmlFor="profile-email" className="block text-sm font-medium text-gray-700">
        Email
      </label>
      <input
        id="profile-email"
        type="email"
        value={profile.email ?? ""}
        readOnly
        autoComplete="email"
        className={readOnlyClass}
      />
      {hasEmail ? (
        <p className="mt-1 text-xs text-gray-500">{verified ? "Verified" : "Not verified"}</p>
      ) : (
        <p className="mt-1 text-sm text-amber-900">
          Add an email address to protect and recover your account.
        </p>
      )}
      {message ? (
        <p
          role="status"
          className={message.type === "ok" ? "mt-2 text-sm text-green-700" : "mt-2 text-sm text-red-600"}
        >
          {message.text}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => {
            setOpen((v) => !v);
            setMessage(null);
          }}
        >
          {hasEmail ? "Change email" : "Add email"}
        </button>
        {hasEmail && !verified ? <ResendVerificationButton /> : null}
      </div>
      {open ? (
        <div className="mt-4 space-y-3 rounded-md border border-gray-200 p-4">
          <div>
            <label htmlFor="change-email-new" className="block text-sm font-medium text-gray-700">
              New email
            </label>
            <input
              id="change-email-new"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="change-email-password" className="block text-sm font-medium text-gray-700">
              Current password
            </label>
            <input
              id="change-email-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
              required
              autoComplete="current-password"
            />
          </div>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={changeMu.isPending}
            onClick={() => changeMu.mutate()}
          >
            {changeMu.isPending ? "Saving…" : "Save email"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
