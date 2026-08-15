import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import {
  changePassword,
  getProfile,
  listHouseholds,
  updateProfile,
} from "@budget-app/api-client";
import { getEffectiveDisplayName } from "@budget-app/shared";
import { useAuth } from "../context/AuthContext";
import { useOperationalAccounts } from "../hooks/useOperationalAccounts";
import { PAGE_SHELL_PY_LOOSE } from "../lib/pageLayout";
import { formatPhoneForDisplay, formatPhoneInput } from "../lib/phoneDisplay";
import { accountsForHousehold, nextDefaultAccountId } from "../lib/profileDefaults";
import {
  clientPasswordErrors,
  passwordApiFieldErrors,
  type PasswordFieldErrors,
} from "../lib/profilePassword";

const PROFILE_STALE_MS = 5 * 60_000;
const inputClass = "mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white";
const readOnlyClass = `${inputClass} bg-gray-50 text-gray-600 cursor-default`;

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} mt-0 pr-10`}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 px-2 text-gray-500 hover:text-gray-800"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
      {error ? (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function Profile() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const usernameHelpId = useId();
  const displayHelpId = useId();
  const phoneHelpId = useId();
  const newPwdHelpId = useId();

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: getProfile,
    staleTime: PROFILE_STALE_MS,
  });
  const { data: households } = useQuery({
    queryKey: ["households"],
    queryFn: listHouseholds,
    staleTime: PROFILE_STALE_MS,
  });
  const { data: accountsData } = useOperationalAccounts();
  const accounts = accountsData?.results ?? [];

  const [displayName, setDisplayName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [defaultHousehold, setDefaultHousehold] = useState<number | "">("");
  const [defaultAccount, setDefaultAccount] = useState<number | "">("");

  const householdAccounts = useMemo(
    () => accountsForHousehold(accounts, defaultHousehold),
    [accounts, defaultHousehold]
  );

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setPhoneInput(formatPhoneForDisplay(profile.phone_e164 ?? ""));
    setDefaultHousehold(profile.default_household ?? "");
    setDefaultAccount(profile.default_account ?? "");
  }, [profile]);

  useEffect(() => {
    setDefaultAccount((prev) => nextDefaultAccountId(prev, defaultHousehold, accounts));
  }, [accounts, defaultHousehold]);

  const [profileMessage, setProfileMessage] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );
  const saveProfileMu = useMutation({
    mutationFn: () =>
      updateProfile({
        display_name: displayName.trim() || "",
        phone_e164: phoneInput.trim() || null,
        default_household: defaultHousehold === "" ? null : Number(defaultHousehold),
        default_account: defaultAccount === "" ? null : Number(defaultAccount),
      }),
    onSuccess: async (saved) => {
      setProfileMessage({ type: "ok", text: "Profile saved." });
      queryClient.setQueryData(["profile"], saved);
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await refreshUser();
    },
    onError: (e: unknown) => {
      setProfileMessage({
        type: "err",
        text: e instanceof Error ? e.message : "Could not save profile.",
      });
    },
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdFieldErrors, setPwdFieldErrors] = useState<PasswordFieldErrors>({});
  const [pwdMessage, setPwdMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const changePasswordMu = useMutation({
    mutationFn: () =>
      changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirm: confirmPassword,
      }),
    onSuccess: () => {
      setPwdMessage({ type: "ok", text: "Password updated." });
      setPwdFieldErrors({});
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e: unknown) => {
      const text = e instanceof Error ? e.message : "Could not change password.";
      setPwdMessage({ type: "err", text });
      setPwdFieldErrors(passwordApiFieldErrors(text));
    },
  });

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (saveProfileMu.isPending) return;
    setProfileMessage(null);
    saveProfileMu.mutate();
  }

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (changePasswordMu.isPending) return;
    setPwdMessage(null);
    const errors = clientPasswordErrors({ currentPassword, newPassword, confirmPassword });
    if (errors) {
      setPwdFieldErrors(errors);
      setPwdMessage({ type: "err", text: "Fix the highlighted password fields." });
      return;
    }
    setPwdFieldErrors({});
    changePasswordMu.mutate();
  }

  if (profileLoading || !profile) {
    return (
      <div className={PAGE_SHELL_PY_LOOSE}>
        <p className="text-gray-600 text-sm">Loading profile…</p>
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL_PY_LOOSE}>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-600 mt-1">Profile and account defaults for this user.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <form onSubmit={handleSaveProfile} className="space-y-6 min-w-0">
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-medium text-gray-900">Profile</h2>
            {profileMessage && (
              <p
                role="status"
                aria-live="polite"
                className={
                  profileMessage.type === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"
                }
              >
                {profileMessage.text}
              </p>
            )}
            <div>
              <label htmlFor="profile-username" className="block text-sm font-medium text-gray-700">
                Username
              </label>
              <input
                id="profile-username"
                type="text"
                value={profile.username}
                readOnly
                autoComplete="username"
                className={readOnlyClass}
                aria-describedby={usernameHelpId}
              />
              <p id={usernameHelpId} className="mt-1 text-xs text-gray-500">
                Account identifier — cannot be changed.
              </p>
            </div>
            <div>
              <label htmlFor="profile-display-name" className="block text-sm font-medium text-gray-700">
                Display name
              </label>
              <input
                id="profile-display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
                autoComplete="nickname"
                placeholder="Optional"
                aria-describedby={displayHelpId}
              />
              <p id={displayHelpId} className="mt-1 text-xs text-gray-500">
                Optional. Shown in the header. Username is used if blank.
              </p>
            </div>
            <div>
              <label htmlFor="profile-phone" className="block text-sm font-medium text-gray-700">
                Mobile phone
              </label>
              <input
                id="profile-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(formatPhoneInput(e.target.value))}
                className={inputClass}
                placeholder="(520) 461-5387"
                aria-describedby={phoneHelpId}
              />
              <p id={phoneHelpId} className="mt-1 text-xs text-gray-500">
                Used for Plaid/bank verification text messages.
              </p>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-4">
            <h2 className="text-lg font-medium text-gray-900">Defaults</h2>
            <div>
              <label htmlFor="profile-household" className="block text-sm font-medium text-gray-700">
                Default household
              </label>
              <select
                id="profile-household"
                value={defaultHousehold === "" ? "" : String(defaultHousehold)}
                onChange={(e) => {
                  const v = e.target.value === "" ? "" : Number(e.target.value);
                  setDefaultHousehold(v);
                  setDefaultAccount((prev) => nextDefaultAccountId(prev, v, accounts));
                }}
                className={inputClass}
              >
                <option value="">—</option>
                {(households ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="profile-account" className="block text-sm font-medium text-gray-700">
                Default account
              </label>
              <select
                id="profile-account"
                value={defaultAccount === "" ? "" : String(defaultAccount)}
                onChange={(e) => {
                  const v = e.target.value;
                  setDefaultAccount(v === "" ? "" : Number(v));
                }}
                className={inputClass}
                disabled={defaultHousehold === ""}
              >
                <option value="">— None</option>
                {householdAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {getEffectiveDisplayName(a)}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">Optional. Only accounts in the selected household.</p>
            </div>
            <button
              type="submit"
              disabled={saveProfileMu.isPending}
              className="py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saveProfileMu.isPending ? "Saving…" : "Save profile"}
            </button>
          </section>
        </form>

        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-4 min-w-0">
          <h2 className="text-lg font-medium text-gray-900">Security</h2>
          <form onSubmit={handleChangePassword} className="space-y-4" autoComplete="off">
            {pwdMessage && (
              <p
                role="status"
                aria-live="polite"
                className={pwdMessage.type === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"}
              >
                {pwdMessage.text}
              </p>
            )}
            <PasswordField
              id="current-password"
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              error={pwdFieldErrors.current}
            />
            <PasswordField
              id="new-password"
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              error={pwdFieldErrors.next}
              describedBy={newPwdHelpId}
            />
            <p id={newPwdHelpId} className="text-xs text-gray-500 -mt-2">
              At least 8 characters. Avoid common or all-numeric passwords.
            </p>
            <PasswordField
              id="confirm-password"
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              error={pwdFieldErrors.confirm}
            />
            <button
              type="submit"
              disabled={changePasswordMu.isPending}
              className="py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {changePasswordMu.isPending ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
