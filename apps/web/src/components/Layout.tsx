import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import NotificationsDropdown from "./NotificationsDropdown";

export default function Layout() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const nav = [
    { to: "/", label: "Dashboard" },
    { to: "/timeline", label: "Timeline" },
    { to: "/accounts", label: "Accounts" },
    { to: "/rules", label: "Rules" },
    { to: "/categories", label: "Categories" },
    { to: "/transactions", label: "Transactions" },
    { to: "/scenarios", label: "Scenarios" },
    { to: "/budget", label: "Budget" },
    { to: "/reconcile", label: "Reconcile" },
    { to: "/reports", label: "Reports" },
    { to: "/profile", label: "Profile" },
  ];

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="flex-none bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 flex justify-between items-center h-14">
          <nav className="flex gap-4">
            {nav.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `px-3 py-2 rounded text-sm font-medium ${isActive ? "bg-gray-100 text-blue-600" : "text-gray-700 hover:bg-gray-50"}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <NotificationsDropdown />
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `text-sm ${isActive ? "text-blue-600 font-medium" : "text-gray-600 hover:text-gray-900"}`
              }
            >
              {auth.user?.username ?? "User"}
            </NavLink>
            <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-700">
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-gray-50">
        <Outlet />
      </main>
    </div>
  );
}
