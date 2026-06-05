import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  changePassword,
  getProfile,
  listAccounts,
  listHouseholds,
  updateProfile,
} from "@budget-app/api-client";
import { getEffectiveDisplayName } from "@budget-app/shared";
import { useAuth } from "../context/AuthContext";
import { PAGE_SHELL_PY_LOOSE } from "../lib/pageLayout";

export default function Profile() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: getProfile,
  });
  const { data: households } = useQuery({
    queryKey: ["households"],
    queryFn: listHouseholds,
  });

  const [displayName, setDisplayName] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [defaultHousehold, setDefaultHousehold] = useState<number | "">("");
  const [defaultAccount, setDefaultAccount] = useState<number | "">("");

  const householdNum = defaultHousehold === "" ? null : Number(defaultHousehold);
  const { data: accountsData } = useQuery({
    queryKey: ["accounts", "profile-defaults", householdNum],
    queryFn: () =>
      listAccounts({ household: householdNum!, page_size: 200, active_only: true }),
    enabled: householdNum != null && !Number.isNaN(householdNum),
  });
  const accounts = accountsData?.results ?? [];

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setPhoneE164(profile.phone_e164 ?? "");
    setDefaultHousehold(profile.default_household ?? "");
    setDefaultAccount(profile.default_account ?? "");
  }, [profile]);

  const [profileMessage, setProfileMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const saveProfileMu = useMutation({
    mutationFn: () =>
      updateProfile({
        display_name: displayName.trim() || "",
        phone_e164: phoneE164.trim() || null,
        default_household: defaultHousehold === "" ? null : Number(defaultHousehold),
        default_account: defaultAccount === "" ? null : Number(defaultAccount),
      }),
    onSuccess: async () => {
      setProfileMessage({ type: "ok", text: "Profile saved." });
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
  const [pwdMessage, setPwdMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const changePasswordMu = useMutation({
    mutationFn: () =>
      changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        new_password_confirm: confirmPassword,
      }),
    onSuccess: () => {
      setPwdMessage({ type: "ok", text: "Password updated. Use it next time you log in." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e: unknown) => {
      setPwdMessage({
        type: "err",
        text: e instanceof Error ? e.message : "Could not change password.",
      });
    },
  });

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileMessage(null);
    saveProfileMu.mutate();
  }

  function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMessage(null);
    if (newPassword.length < 8) {
      setPwdMessage({ type: "err", text: "New password must be at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdMessage({ type: "err", text: "New password and confirmation do not match." });
      return;
    }
    changePasswordMu.mutate();
  }

  const inputClass =
    "mt-1 block w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white";

  if (profileLoading || !profile) {
    return (
      <div className={PAGE_SHELL_PY_LOOSE}>
        <p className="text-gray-600 text-sm">Loading profile…</p>
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL_PY_LOOSE}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Account</h2>
          <form onSubmit={handleSaveProfile} className="space-y-4">
            {profileMessage && (
              <p
                className={
                  profileMessage.type === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"
                }
              >
                {profileMessage.text}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Username</label>
                <input
                  type="text"
                  value={profile.username}
                  disabled
                  className={`${inputClass} bg-gray-50 text-gray-600`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Display name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={inputClass}
                  placeholder="Shown in the header"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Mobile phone</label>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phoneE164}
                  onChange={(e) => setPhoneE164(e.target.value)}
                  className={inputClass}
                  placeholder="5204615387 or +15204615387"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Used for Plaid SMS verification. Saved as E.164 on the server.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Default household</label>
                <select
                  value={defaultHousehold === "" ? "" : String(defaultHousehold)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDefaultHousehold(v === "" ? "" : Number(v));
                    setDefaultAccount("");
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
                <label className="block text-sm font-medium text-gray-700">
                  Default account (optional)
                </label>
                <select
                  value={defaultAccount === "" ? "" : String(defaultAccount)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDefaultAccount(v === "" ? "" : Number(v));
                  }}
                  className={inputClass}
                  disabled={householdNum == null}
                >
                  <option value="">—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {getEffectiveDisplayName(a)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              disabled={saveProfileMu.isPending}
              className="py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saveProfileMu.isPending ? "Saving…" : "Save profile"}
            </button>
          </form>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 sm:p-8 space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Change password</h2>
          <form onSubmit={handleChangePassword} className="space-y-4">
            {pwdMessage && (
              <p
                className={
                  pwdMessage.type === "ok" ? "text-sm text-green-700" : "text-sm text-red-600"
                }
              >
                {pwdMessage.text}
              </p>
            )}
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={inputClass}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">New password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={inputClass}
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                  <p className="mt-1 text-xs text-gray-500">At least 8 characters.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Confirm new password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClass}
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                </div>
              </div>
            </div>
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
