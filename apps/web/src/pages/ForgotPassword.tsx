import { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "@budget-app/api-client";
import PublicScreen from "../components/legal/PublicScreen";

const NEUTRAL_DETAIL = "If an account exists for that email, we've sent password reset instructions.";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not send reset instructions.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicScreen>
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
        <h1 className="text-2xl font-bold text-center">Forgot password?</h1>
        {submitted ? (
          <p className="text-sm text-gray-700" data-testid="forgot-password-confirmation">
            {NEUTRAL_DETAIL}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error ? <p className="text-red-600 text-sm">{error}</p> : null}
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded border border-gray-300 px-3 py-2"
                required
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send reset instructions"}
            </button>
          </form>
        )}
        <p className="text-center text-sm text-gray-600">
          <Link to="/login" className="text-blue-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </PublicScreen>
  );
}
