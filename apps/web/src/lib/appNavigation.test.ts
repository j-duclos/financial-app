import { describe, expect, it } from "vitest";
import {
  isNavMenuActive,
  isPrimaryLinkActive,
  MORE_NAV_LINKS,
  pathMatchesNavLink,
  PLANNING_NAV_LINKS,
  PRIMARY_NAV,
} from "./appNavigation";

describe("appNavigation", () => {
  it("exposes workflow-first primary destinations", () => {
    const labels = PRIMARY_NAV.map((item) => item.label);
    expect(labels).toEqual([
      "Dashboard",
      "Action Center",
      "Transactions",
      "Calendar",
      "Accounts",
      "Budget",
      "Planning",
      "Reports",
      "More",
    ]);
  });

  it("groups planning destinations under Planning", () => {
    expect(PLANNING_NAV_LINKS.map((l) => l.label)).toEqual([
      "Goals",
      "Payment Planner",
      "What-If",
    ]);
    expect(isNavMenuActive("/goals", PLANNING_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/goals/12", PLANNING_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/payment-planner", PLANNING_NAV_LINKS)).toBe(false);
    expect(isNavMenuActive("/credit-cards", PLANNING_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/scenarios", PLANNING_NAV_LINKS)).toBe(true);
  });

  it("groups secondary destinations under More", () => {
    const labels = MORE_NAV_LINKS.map((l) => l.label);
    expect(labels).toContain("Recurring");
    expect(labels).toContain("Rules & Automation");
    expect(labels).toContain("Reconcile");
    expect(labels).toContain("Categories");
    expect(labels).toContain("Settings");
    expect(isNavMenuActive("/categories", MORE_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/reconcile", MORE_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/profile", MORE_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/automation", MORE_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/goals", MORE_NAV_LINKS)).toBe(false);
  });

  it("marks Dashboard active only on the index path", () => {
    const dashboard = PRIMARY_NAV.find((item) => item.kind === "link" && item.to === "/");
    expect(dashboard?.kind).toBe("link");
    if (dashboard?.kind !== "link") return;
    expect(isPrimaryLinkActive("/", dashboard)).toBe(true);
    expect(isPrimaryLinkActive("/accounts", dashboard)).toBe(false);
  });

  it("matches nested goal routes", () => {
    const goals = PLANNING_NAV_LINKS.find((l) => l.to === "/goals")!;
    expect(pathMatchesNavLink("/goals", goals)).toBe(true);
    expect(pathMatchesNavLink("/goals/3", goals)).toBe(true);
    expect(pathMatchesNavLink("/goal", goals)).toBe(false);
  });
});
