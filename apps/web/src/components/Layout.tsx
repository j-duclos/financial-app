import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { APP_NAME, shouldShowOnboardingWelcome } from "@budget-app/shared";
import { useAuth } from "../context/AuthContext";
import NotificationsDropdown from "./NotificationsDropdown";
import { PlaidAutoSync } from "./PlaidAutoSync";
import AppNav from "./AppNav";
import BillingReturnBanner from "./billing/BillingReturnBanner";
import EmailVerificationBanner from "./EmailVerificationBanner";
import ProjectedFundsAlertBanner from "./ProjectedFundsAlertBanner";
import SiteFooter from "./legal/SiteFooter";
import OnboardingWelcomeModal from "./onboarding/OnboardingWelcomeModal";
import { BrandWordmark } from "./brand/BrandWordmark";
import { useOnboardingActions, useOnboardingStatus } from "../hooks/useOnboardingStatus";

export default function Layout() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const { status } = useOnboardingStatus();
  const { dismissMu } = useOnboardingActions();
  const [welcomeAcked, setWelcomeAcked] = useState(false);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <PlaidAutoSync />
      <OnboardingWelcomeModal
        open={shouldShowOnboardingWelcome(status) && !welcomeAcked}
        onGetStarted={() => setWelcomeAcked(true)}
        onSkip={() => dismissMu.mutate()}
        skipPending={dismissMu.isPending}
      />
      <header className="flex-none sticky top-0 z-30 bg-white border-b border-gray-200">
        <div className="px-4 flex items-center justify-between gap-x-3 min-h-14 py-2">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <NavLink to="/" className="shrink-0" aria-label={APP_NAME}>
              <BrandWordmark size="small" />
            </NavLink>
            <AppNav />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NotificationsDropdown />
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `text-sm ${isActive ? "text-blue-600 font-medium" : "text-gray-600 hover:text-gray-900"}`
              }
            >
              {auth.user?.username ?? "User"}
            </NavLink>
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700 whitespace-nowrap"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full bg-gray-50">
        <BillingReturnBanner />
        <EmailVerificationBanner />
        <ProjectedFundsAlertBanner />
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
