import { useAuth } from "../context/AuthContext";
import { Navigate } from "react-router-dom";
import { APP_NAME } from "@budget-app/shared";
import BrandLockup from "../components/brand/BrandLockup";
import PublicScreen from "../components/legal/PublicScreen";
import LoadingScreen from "../components/brand/LoadingScreen";

/** Native app scheme from apps/mobile/app.config.ts — not a website login. */
export const FLOWSIGHT_APP_PROFILE_HREF = "budgetapp://profile";

/**
 * Stripe Customer Portal return URL. Must stay public: sending /profile here
 * dumps mobile users onto the website login screen.
 */
export default function BillingPortalReturn() {
  const { auth } = useAuth();

  if (auth.loading) {
    return <LoadingScreen />;
  }
  if (auth.access) {
    return <Navigate to="/profile?billing=portal" replace />;
  }

  return (
    <PublicScreen>
      <div className="max-w-md w-full space-y-6 p-8 bg-white rounded-lg shadow text-center">
        <BrandLockup showTagline={false} />
        <h1 className="text-xl font-semibold text-gray-900">Back to {APP_NAME}</h1>
        <p className="text-sm text-gray-600">
          You can close this window to return to the {APP_NAME} app. If you opened billing from
          Settings, you should be back on Profile &amp; Settings.
        </p>
        <a
          href={FLOWSIGHT_APP_PROFILE_HREF}
          className="inline-flex items-center justify-center w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
        >
          Open {APP_NAME}
        </a>
      </div>
    </PublicScreen>
  );
}
