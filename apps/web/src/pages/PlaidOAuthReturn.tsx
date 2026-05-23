import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getProfile } from "@budget-app/api-client";
import { PlaidConnectBar } from "../components/PlaidConnectBar";

/**
 * Dedicated Plaid OAuth return URL (Chase and other OAuth institutions).
 * Plaid redirects here with ?oauth_state_id=…; PlaidConnectBar resumes Link with the stored link_token.
 */
export default function PlaidOAuthReturn() {
  const { data: profile, isLoading } = useQuery({ queryKey: ["profile"], queryFn: getProfile });
  const householdId = profile?.default_household ?? null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-slate-50">
      <div className="w-full max-w-lg space-y-3 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Finishing bank sign-in</h1>
        <p className="text-sm text-slate-600">
          Complete the steps in the Plaid window if it opened. When done, you will return to Accounts.
        </p>
      </div>
      <div className="w-full max-w-xl">
        {/* Mount immediately so oauth_state_id handling runs before profile finishes loading. */}
        <PlaidConnectBar householdId={householdId} redirectAfterLink="/accounts" oauthReturnPage />
        {isLoading && householdId == null ? (
          <p className="text-sm text-slate-500 text-center mt-2">Loading profile…</p>
        ) : null}
      </div>
      <Link to="/accounts" className="text-sm text-slate-600 underline hover:text-slate-900">
        Back to Accounts
      </Link>
    </div>
  );
}
