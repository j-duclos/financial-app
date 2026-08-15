import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationsDropdown from "./NotificationsDropdown";
import { PlaidAutoSync } from "./PlaidAutoSync";
import AppNav from "./AppNav";

export default function Layout() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <PlaidAutoSync />
      <header className="flex-none sticky top-0 z-30 bg-white border-b border-gray-200">
        <div className="px-4 flex items-center justify-between gap-x-3 min-h-14 py-2">
          <AppNav />
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
        <Outlet />
      </main>
    </div>
  );
}
