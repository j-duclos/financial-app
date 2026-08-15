import { NavLink, useLocation } from "react-router-dom";
import { PLANNING_NAV_LINKS, pathMatchesNavLink } from "../lib/appNavigation";

const HINTS: Record<string, string> = {
  "/goals": "What am I trying to accomplish?",
  "/credit-cards": "How should I eliminate debt?",
  "/scenarios": "What happens if I change something?",
};

export default function PlanningSubnav() {
  const { pathname } = useLocation();
  return (
    <nav
      aria-label="Planning"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600"
    >
      {PLANNING_NAV_LINKS.map((link) => {
        const active = pathMatchesNavLink(pathname, link);
        return (
          <NavLink
            key={link.to}
            to={link.to}
            title={HINTS[link.to]}
            className={active ? "font-medium text-blue-700" : "hover:text-gray-900"}
          >
            {link.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
