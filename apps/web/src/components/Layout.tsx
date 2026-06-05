import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationsDropdown from "./NotificationsDropdown";
import { AUTOMATION_NAV_LABEL, AUTOMATION_PATH } from "../lib/automationDisplay";

export default function Layout() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const primaryNav = [
    { to: "/", label: "Dashboard" },
    { to: "/timeline", label: "Calendar" },
    { to: "/accounts", label: "Accounts" },
    { to: "/transactions", label: "Transactions" },
    { to: "/recurring", label: "Recurring" },
    { to: "/spending-goals", label: "Spending Limits" },
    { to: "/goals", label: "Goals" },
    { to: "/credit-cards", label: "Payment Planner" },
    { to: "/scenarios", label: "What-If" },
    { to: "/reports", label: "Reports" },
  ];

  const secondaryNav = [
    { to: AUTOMATION_PATH, label: AUTOMATION_NAV_LABEL },
    { to: "/categories", label: "Categories" },
    { to: "/reconcile", label: "Reconcile" },
    { to: "/profile", label: "Profile" },
  ];

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-2 py-2 rounded text-sm font-medium whitespace-nowrap ${
      isActive ? "bg-gray-100 text-blue-600" : "text-gray-700 hover:bg-gray-50"
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex-none sticky top-0 z-30 bg-white border-b border-gray-200">
        <div className="px-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-h-14 py-2">
          <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 min-w-0 flex-1">
            {primaryNav.map(({ to, label }) => (
              <NavLink key={to} to={to} className={navLinkClass}>
                {label}
              </NavLink>
            ))}
            <span className="mx-1 h-6 w-px shrink-0 bg-gray-300" aria-hidden />
            {secondaryNav.map(({ to, label }) => (
              <NavLink key={to} to={to} className={navLinkClass}>
                {label}
              </NavLink>
            ))}
          </nav>
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
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700 whitespace-nowrap"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}
