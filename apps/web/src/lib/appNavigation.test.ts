import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isNavMenuActive,
  isPrimaryLinkActive,
  MORE_NAV_LINKS,
  pathMatchesNavLink,
  PLANNING_NAV_LINKS,
  PRIMARY_NAV,
  STAFF_BETA_TESTERS_LABEL,
  STAFF_BETA_TESTERS_PATH,
} from "./appNavigation";

const appNavSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/AppNav.tsx"),
  "utf8"
);
const appSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../App.tsx"),
  "utf8"
);

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
      "Debt-to-Income",
      "What-If",
    ]);
    expect(isNavMenuActive("/goals", PLANNING_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/goals/12", PLANNING_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/payment-planner", PLANNING_NAV_LINKS)).toBe(false);
    expect(isNavMenuActive("/credit-cards", PLANNING_NAV_LINKS)).toBe(true);
    expect(isNavMenuActive("/debt-to-income", PLANNING_NAV_LINKS)).toBe(true);
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

  it("keeps Beta Testers out of customer navigation", () => {
    const customerLabels = [
      ...PRIMARY_NAV.map((item) => item.label),
      ...MORE_NAV_LINKS.map((l) => l.label),
      ...PLANNING_NAV_LINKS.map((l) => l.label),
    ];
    expect(customerLabels).not.toContain("Beta Testers");
    expect(MORE_NAV_LINKS.some((l) => l.to.includes("beta-testers"))).toBe(false);
    expect(PRIMARY_NAV.some((item) => item.kind === "link" && item.to.includes("beta-testers"))).toBe(
      false
    );
  });

  it("shows Beta Testers in staff navigation only", () => {
    expect(STAFF_BETA_TESTERS_PATH).toBe("/internal/beta-testers");
    expect(STAFF_BETA_TESTERS_LABEL).toBe("Beta Testers");
    expect(appNavSource).toMatch(/is_staff/);
    expect(appNavSource).toMatch(/STAFF_BETA_TESTERS_LABEL/);
    expect(appNavSource).toMatch(/FlaskConical/);
    expect(appSource).toMatch(/path="internal\/beta-testers"/);
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
