import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { resetPassword } from "@budget-app/api-client";

export default function ResetPassword() {
  const [params, setParams] = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const clientError = useMemo(() => {
    if (password && confirm && password !== confirm) return "Passwords do not match.";
    return "";
  }, [password, confirm]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (clientError) {
      setError(clientError);
      return;
    }
    setError("");
    setBusy(true);
    try {
      await resetPassword({
        uid,
        token,
        new_password: password,
        new_password_confirm: confirm,
      });
      setDone(true);
      setParams({}, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
        <h1 className="text-2xl font-bold text-center">Reset password</h1>
        {done ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">Your password has been reset.</p>
            <Link
              to="/login"
              className="block w-full text-center py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error ? <p className="text-red-600 text-sm">{error}</p> : null}
            {!uid || !token ? (
              <p className="text-sm text-red-600">This reset link is missing required information.</p>
            ) : null}
            <div>
              <label className="block text-sm font-medium text-gray-700">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !uid || !token}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Reset password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
