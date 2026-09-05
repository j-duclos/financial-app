import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, "DebtToIncome.tsx"), "utf8");
const app = readFileSync(join(dir, "../App.tsx"), "utf8");
const nav = readFileSync(join(dir, "../lib/appNavigation.ts"), "utf8");
const subnav = readFileSync(join(dir, "../components/PlanningSubnav.tsx"), "utf8");
const appNav = readFileSync(join(dir, "../components/AppNav.tsx"), "utf8");
const helpers = [
  readFileSync(join(dir, "../lib/dtiForm.ts"), "utf8"),
  readFileSync(join(dir, "../lib/dtiDisplay.ts"), "utf8"),
  page,
].join("\n");

describe("Debt-to-Income architecture", () => {
  it("registers /debt-to-income inside the protected layout", () => {
    expect(app).toMatch(/path="debt-to-income"/);
    expect(app).toMatch(/ProtectedRoute/);
    expect(app).toMatch(/DebtToIncome/);
  });

  it("adds Debt-to-Income to Planning between Payment Planner and What-If", () => {
    const labels = [...nav.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels.slice(labels.indexOf("Goals"), labels.indexOf("What-If") + 1)).toEqual([
      "Goals",
      "Payment Planner",
      "Debt-to-Income",
      "What-If",
    ]);
  });

  it("uses the shared Planning nav configuration on desktop, mobile, and subnav", () => {
    expect(appNav).toMatch(/PRIMARY_NAV/);
    expect(appNav).toMatch(/lg:hidden/);
    expect(subnav).toMatch(/PLANNING_NAV_LINKS/);
    expect(page).toMatch(/PlanningSubnav/);
  });

  it("does not call timeline or forecast endpoints", () => {
    expect(page).not.toMatch(/getTimeline|listTransactions|getDebtPayoffPlan|listScenarios/);
  });

  it("does not reimplement DTI formulas or hard-code lender programs", () => {
    expect(helpers).not.toMatch(/front_end.*=.*housing.*\/.*income/i);
    expect(helpers).not.toMatch(/back_end.*=.*\+.*debt.*\/.*income/i);
    expect(helpers).not.toMatch(/\/ income \* 100/);
    expect(helpers).not.toMatch(
      /FHA|conventional|USDA|\bVA\b|You qualify|Approved|Denied|Lender limit|Safe mortgage|Maximum mortgage approval/
    );
  });
});
