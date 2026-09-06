import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyEmail } from "@budget-app/api-client";
import { useAuth } from "../context/AuthContext";
import PublicScreen from "../components/legal/PublicScreen";

type Status = "verifying" | "verified" | "already_verified" | "expired" | "invalid";

export default function VerifyEmail() {
  const [params, setParams] = useSearchParams();
  const token = params.get("token") ?? "";
  const processed = useRef(false);
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState<Status>(token ? "verifying" : "invalid");

  useEffect(() => {
    if (!token || processed.current) return;
    processed.current = true;
    let cancelled = false;
    verifyEmail(token)
      .then(async (result) => {
        if (cancelled) return;
        if (result.status === "verified" || result.status === "already_verified") {
          setStatus(result.status);
          await refreshUser();
        } else if (result.status === "expired") {
          setStatus("expired");
        } else {
          setStatus("invalid");
        }
        setParams({}, { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "";
        if (message.includes("expired")) setStatus("expired");
        else setStatus("invalid");
        setParams({}, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [token, setParams, refreshUser]);

  const copy =
    status === "verifying"
      ? "Verifying..."
      : status === "verified" || status === "already_verified"
        ? "Email verified."
        : status === "expired"
          ? "Verification link expired"
          : "Invalid verification link";

  return (
    <PublicScreen>
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow text-center">
        <h1 className="text-2xl font-bold">Verify email</h1>
        <p className="text-sm text-gray-700">{copy}</p>
        {status === "verified" || status === "already_verified" ? (
          <Link
            to="/"
            className="inline-flex justify-center w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Continue to app
          </Link>
        ) : status === "verifying" ? null : (
          <Link to="/login" className="text-sm text-blue-600 hover:underline">
            Sign in
          </Link>
        )}
      </div>
    </PublicScreen>
  );
}
