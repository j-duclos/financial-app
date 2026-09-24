import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, acceptComplimentaryInvitation, previewComplimentaryInvitation } from "@budget-app/api-client";
import { formatFullDate } from "@budget-app/shared";
import { useAuth } from "../context/AuthContext";
import BrandLockup from "../components/brand/BrandLockup";
import PublicScreen from "../components/legal/PublicScreen";
import { BILLING_STATUS_QUERY_KEY } from "../lib/billing";
import { PROFILE_QUERY_KEY } from "../lib/profileQuery";
import {
  clearPremiumInviteToken,
  inviteLoginPath,
  inviteRegisterPath,
  persistPremiumInviteToken,
} from "../lib/premiumInvite";
import ResendVerificationButton from "../components/ResendVerificationButton";

type PreviewState =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | {
      kind: "pending";
      email: string;
      until: string | null;
    }
  | { kind: "accepted"; until: string | null };

const MISMATCH = "This invitation was sent to a different email address.";

function untilLabel(iso: string | null | undefined): string | null {
  return formatFullDate(iso);
}

export default function Invite() {
  const [params] = useSearchParams();
  const token = (params.get("token") || "").trim();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const acceptAttempted = useRef(false);
  const [preview, setPreview] = useState<PreviewState>({ kind: "loading" });
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const signedIn = Boolean(auth.access) && !auth.loading;

  useEffect(() => {
    if (token) persistPremiumInviteToken(token);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setPreview({ kind: "invalid", message: "This invitation is no longer valid." });
      return;
    }
    let cancelled = false;
    previewComplimentaryInvitation(token)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "pending" && result.email) {
          setPreview({
            kind: "pending",
            email: result.email,
            until: result.complimentary_premium_until ?? null,
          });
          return;
        }
        if (result.status === "expired") {
          setPreview({ kind: "invalid", message: "This invitation has expired." });
          return;
        }
        if (result.status === "accepted") {
          setPreview({
            kind: "accepted",
            until: result.complimentary_premium_until ?? null,
          });
          return;
        }
        setPreview({ kind: "invalid", message: "This invitation is no longer valid." });
      })
      .catch(() => {
        if (!cancelled) {
          setPreview({ kind: "invalid", message: "This invitation is no longer valid." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (preview.kind !== "accepted") return;
    void queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
  }, [preview.kind, queryClient]);

  useEffect(() => {
    if (!signedIn || !token || preview.kind !== "pending" || acceptAttempted.current) return;
    acceptAttempted.current = true;
    let cancelled = false;
    acceptComplimentaryInvitation(token)
      .then(async (result) => {
        if (cancelled) return;
        clearPremiumInviteToken();
        await queryClient.invalidateQueries({ queryKey: BILLING_STATUS_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
        setPreview({
          kind: "accepted",
          until: result.complimentary_premium_until,
        });
        setAcceptError(null);
        setNeedsVerification(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const code = err instanceof ApiError ? err.code || "" : "";
        const message = err instanceof ApiError ? err.message : "";
        if (code === "email_verification_required") {
          setNeedsVerification(true);
          setAcceptError(null);
          acceptAttempted.current = false;
          return;
        }
        if (code === "email_mismatch" || message.includes("different email")) {
          setAcceptError(MISMATCH);
          return;
        }
        if (code === "expired") {
          setPreview({ kind: "invalid", message: "This invitation has expired." });
          return;
        }
        setAcceptError("This invitation is no longer valid.");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, token, preview, queryClient]);

  const until = preview.kind === "pending" || preview.kind === "accepted" ? preview.until : null;
  const untilText = useMemo(() => untilLabel(until), [until]);

  if (auth.loading || preview.kind === "loading") {
    return (
      <PublicScreen>
        <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow text-center">
          <BrandLockup size="medium" showTagline={false} />
          <p className="text-sm text-gray-700">Loading invitation…</p>
        </div>
      </PublicScreen>
    );
  }

  if (preview.kind === "accepted") {
    return (
      <PublicScreen>
        <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow text-center">
          <BrandLockup size="medium" showTagline={false} />
          <h1 className="text-2xl font-bold text-gray-900">FlowSight Premium activated</h1>
          <p className="text-sm text-gray-700">
            {untilText
              ? `Your complimentary Premium access is active through ${untilText}.`
              : "Your complimentary Premium access is active."}
          </p>
          <button
            type="button"
            className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => navigate("/", { replace: true })}
          >
            Continue to FlowSight
          </button>
        </div>
      </PublicScreen>
    );
  }

  if (preview.kind === "invalid") {
    return (
      <PublicScreen>
        <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow text-center">
          <BrandLockup size="medium" showTagline={false} />
          <h1 className="text-2xl font-bold text-gray-900">Invitation unavailable</h1>
          <p className="text-sm text-gray-700">{preview.message}</p>
          <Link to="/login" className="text-sm text-blue-600 hover:underline">
            Sign in
          </Link>
        </div>
      </PublicScreen>
    );
  }

  return (
    <PublicScreen>
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow">
        <BrandLockup size="medium" showTagline={false} />
        <h1 className="text-2xl font-bold text-center text-gray-900">
          You&apos;re invited to FlowSight Premium
        </h1>
        <p className="text-sm text-gray-700 text-center">
          This complimentary Premium invitation was sent to{" "}
          <span className="font-medium text-gray-900">{preview.email}</span>.
        </p>
        {untilText ? (
          <p className="text-sm text-gray-600 text-center">Active through {untilText}.</p>
        ) : null}
        {acceptError ? <p className="text-sm text-red-600 text-center">{acceptError}</p> : null}
        {needsVerification ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-gray-700">
              Verify {preview.email} to activate complimentary Premium. You can keep using FlowSight
              while you confirm.
            </p>
            <ResendVerificationButton />
          </div>
        ) : null}
        {!signedIn ? (
          <div className="space-y-3">
            <Link
              to={inviteRegisterPath(token, preview.email)}
              className="block w-full py-2 px-4 bg-blue-600 text-white text-center rounded hover:bg-blue-700"
            >
              Create account
            </Link>
            <Link
              to={inviteLoginPath(token)}
              className="block w-full py-2 px-4 bg-white text-gray-800 text-center rounded border border-gray-300 hover:bg-gray-50"
            >
              Sign in to accept
            </Link>
          </div>
        ) : null}
      </div>
    </PublicScreen>
  );
}
