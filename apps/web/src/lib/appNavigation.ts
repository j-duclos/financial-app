import { AUTOMATION_NAV_LABEL, AUTOMATION_PATH } from "./automationDisplay";
import { SPENDING_GOALS_PATH } from "./spendingTargetDisplay";

export type AppNavLink = {
  to: string;
  label: string;
  /** Match this path and nested routes (e.g. /goals/:id). */
  matchPrefixes?: string[];
};

export type AppNavItem =
  | { kind: "link"; to: string; label: string; end?: boolean }
  | { kind: "menu"; id: "planning" | "more"; label: string; children: AppNavLink[] };

export const PLANNING_NAV_LINKS: AppNavLink[] = [
  {
    to: "/goals",
    label: "Goals",
    matchPrefixes: ["/goals"],
  },
  {
    to: "/credit-cards",
    label: "Payment Planner",
    matchPrefixes: ["/credit-cards"],
  },
  {
    to: "/debt-to-income",
    label: "Debt-to-Income",
    matchPrefixes: ["/debt-to-income"],
  },
  {
    to: "/scenarios",
    label: "What-If",
    matchPrefixes: ["/scenarios"],
  },
];

export const MORE_NAV_LINKS: AppNavLink[] = [
  { to: "/recurring", label: "Recurring", matchPrefixes: ["/recurring"] },
  { to: AUTOMATION_PATH, label: AUTOMATION_NAV_LABEL, matchPrefixes: [AUTOMATION_PATH] },
  { to: "/reconcile", label: "Reconcile", matchPrefixes: ["/reconcile"] },
  { to: "/categories", label: "Categories", matchPrefixes: ["/categories"] },
  { to: "/profile", label: "Settings", matchPrefixes: ["/profile"] },
];

/** Primary workflow destinations. Planning and More are grouped menus. */
export const PRIMARY_NAV: AppNavItem[] = [
  { kind: "link", to: "/", label: "Dashboard", end: true },
  { kind: "link", to: "/action-center", label: "Action Center" },
  { kind: "link", to: "/transactions", label: "Transactions" },
  { kind: "link", to: "/timeline", label: "Calendar" },
  { kind: "link", to: "/accounts", label: "Accounts" },
  { kind: "link", to: SPENDING_GOALS_PATH, label: "Budget" },
  { kind: "menu", id: "planning", label: "Planning", children: PLANNING_NAV_LINKS },
  { kind: "link", to: "/reports", label: "Reports" },
  { kind: "menu", id: "more", label: "More", children: MORE_NAV_LINKS },
];

export function pathMatchesNavLink(pathname: string, link: AppNavLink): boolean {
  if (pathname === link.to) return true;
  for (const prefix of link.matchPrefixes ?? []) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export function isNavMenuActive(pathname: string, children: AppNavLink[]): boolean {
  return children.some((child) => pathMatchesNavLink(pathname, child));
}

export function isPrimaryLinkActive(
  pathname: string,
  item: Extract<AppNavItem, { kind: "link" }>
): boolean {
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
