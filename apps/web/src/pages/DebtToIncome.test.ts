import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, "DebtToIncome.tsx"), "utf8");
const incomeModal = readFileSync(join(dir, "../components/dti/DtiIncomeFormModal.tsx"), "utf8");
const debtModal = readFileSync(join(dir, "../components/dti/DtiDebtFormModal.tsx"), "utf8");
const profileModal = readFileSync(join(dir, "../components/dti/DtiProfileFormModal.tsx"), "utf8");
const app = readFileSync(join(dir, "../App.tsx"), "utf8");
const nav = readFileSync(join(dir, "../lib/appNavigation.ts"), "utf8");
const subnav = readFileSync(join(dir, "../components/PlanningSubnav.tsx"), "utf8");
const appNav = readFileSync(join(dir, "../components/AppNav.tsx"), "utf8");
const helpers = [
  readFileSync(join(dir, "../lib/dtiForm.ts"), "utf8"),
  readFileSync(join(dir, "../lib/dtiDisplay.ts"), "utf8"),
  page,
].join("\n");

describe("Debt-to-Income route and navigation", () => {
  it("registers /debt-to-income inside the protected layout", () => {
    expect(app).toMatch(/path="debt-to-income"/);
    expect(app).toMatch(/ProtectedRoute/);
    expect(app).toMatch(/DebtToIncome/);
  });

  it("adds Debt-to-Income to Planning between Payment Planner and What-If", () => {
    expect(nav).toMatch(/label: "Debt-to-Income"/);
    expect(nav).toMatch(/to: "\/debt-to-income"/);
    const labels = [...nav.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    const planningSlice = labels.slice(
      labels.indexOf("Goals"),
      labels.indexOf("What-If") + 1
    );
    expect(planningSlice).toEqual(["Goals", "Payment Planner", "Debt-to-Income", "What-If"]);
  });

  it("uses the shared Planning nav configuration on desktop, mobile, and subnav", () => {
    expect(appNav).toMatch(/PRIMARY_NAV/);
    expect(appNav).toMatch(/lg:hidden/);
    expect(subnav).toMatch(/PLANNING_NAV_LINKS/);
    expect(subnav).toMatch(/How much of my gross income is committed to debt\?/);
    expect(page).toMatch(/PlanningSubnav/);
  });
});

describe("Debt-to-Income data loading", () => {
  it("loads profile, income, debts, suggestions, and calculation", () => {
    expect(page).toMatch(/getDtiProfile/);
    expect(page).toMatch(/listDtiIncomeSources/);
    expect(page).toMatch(/listDtiDebtItems/);
    expect(page).toMatch(/listDtiCreditCardSuggestions/);
    expect(page).toMatch(/calculateDti/);
    expect(page).toMatch(/dtiQueryKeys\.calculation/);
  });

  it("does not render a false 0% DTI while loading", () => {
    expect(page).toMatch(/METRIC_TILE_SKELETON_CLASS/);
    expect(page).toMatch(/status === "calculated"/);
    expect(page).toMatch(/Not available/);
    expect(page).not.toMatch(/value=\{["']0%["']\}/);
  });

  it("does not call timeline or forecast endpoints", () => {
    expect(page).not.toMatch(/getTimeline|listTransactions|getDebtPayoffPlan|listScenarios/);
  });
});

describe("Debt-to-Income summary copy", () => {
  it("labels front-end and back-end DTI distinctly", () => {
    expect(page).toMatch(/Front-end DTI/);
    expect(page).toMatch(/Back-end DTI/);
    expect(page).toMatch(/Housing payment ÷ gross monthly income/);
    expect(page).toMatch(/Housing plus other debt payments ÷ gross monthly income/);
  });

  it("shows income, housing, other debt, and total obligations", () => {
    expect(page).toMatch(/Gross monthly income/);
    expect(page).toMatch(/Current housing payment/);
    expect(page).toMatch(/Other monthly debt/);
    expect(page).toMatch(/Total monthly obligations/);
  });

  it("directs zero-income users to add income without treating 0% as valid", () => {
    expect(page).toMatch(/gross_income_required/);
    expect(page).toMatch(/Add at least one included gross monthly income source to calculate DTI/);
    expect(page).toMatch(/Add income source/);
  });

  it("compares status against the user-selected target, not a lender program", () => {
    expect(page).toMatch(/compareActualToTarget/);
    expect(page).toMatch(/Within your selected target|your selected target/);
    expect(helpers).not.toMatch(/FHA|conventional|USDA|\bVA\b|You qualify|Approved|Denied|Lender limit|Safe mortgage|Maximum mortgage approval/);
  });

  it("labels capacity as a housing payment, not a home price or approval", () => {
    expect(page).toMatch(/Estimated housing payment at your selected back-end DTI target/);
    expect(page).toMatch(/not the home price/);
    expect(page).not.toMatch(/maximum mortgage/i);
  });
});

describe("Debt-to-Income income and debt mutations", () => {
  it("creates income through createDtiIncomeSource and keeps the form open on failure", () => {
    expect(page).toMatch(/createDtiIncomeSource/);
    expect(page).toMatch(/incomeSaveMu\.error/);
    expect(incomeModal).toMatch(/saving \? "Saving…" : initial \? "Save changes"/);
    expect(incomeModal).not.toMatch(/onClose\(\);\s*onSubmit/);
  });

  it("recalculates when included toggles change", () => {
    expect(page).toMatch(/updateDtiIncomeSource\(id, \{ included \}\)/);
    expect(page).toMatch(/updateDtiDebtItem\(id, \{ included \}\)/);
    expect(page).toMatch(/invalidateQueries\(\{ queryKey: \["dti", "calculation"/);
  });

  it("creates ordinary debts as manual payments and shows linked effective minimums", () => {
    expect(debtModal).toMatch(/payment_source: "manual"/);
    expect(page).toMatch(/debtRowView/);
    expect(helpers).toMatch(/effective_monthly_payment/);
    expect(page).toMatch(/Synced from account minimum/);
    expect(page).toMatch(/Updates when the linked account minimum changes/);
  });

  it("does not auto-create suggested credit cards", () => {
    expect(page).toMatch(/listDtiCreditCardSuggestions/);
    expect(page).toMatch(/Credit cards not yet included/);
    expect(page).toMatch(/Add to DTI/);
    expect(page).toMatch(/suggestions only/);
    expect(page).not.toMatch(/suggestions\.forEach/);
    expect(page).toMatch(/suggestionPrefill/);
  });

  it("requests a manual payment when a suggested minimum is unusable", () => {
    expect(debtModal).toMatch(/no usable minimum payment/);
    expect(debtModal).toMatch(/Enter a monthly obligation manually/);
  });
});

describe("Debt-to-Income proposed housing and payoffs", () => {
  it("submits proposed housing components and displays the backend total", () => {
    expect(page).toMatch(/normalizeProposedHousingDraft/);
    expect(page).toMatch(/proposedResult\.housing\.total/);
    expect(page).toMatch(/replaces your current housing payment/);
    expect(page).toMatch(/Clear proposed home/);
    expect(page).toMatch(/setAppliedProposed\(null\)/);
    expect(page).toMatch(/Current and proposed|Proposed front-end DTI|Proposed back-end DTI/);
  });

  it("models combined payoffs through excluded_debt_item_ids without deleting debts", () => {
    expect(page).toMatch(/excludedDebtItemIds/);
    expect(page).toMatch(/toggleExcludedDebtItemId/);
    expect(page).toMatch(/Modeled as paid off/);
    expect(page).toMatch(/Clear selected payoffs/);
    expect(page).toMatch(/does not change included flags/);
    expect(page).toMatch(/excludedDebtIds\.length > 0/);
    expect(page).not.toMatch(/deleteDtiDebtItem\(impact/);
  });

  it("keeps individual payoff impact on the baseline calculation", () => {
    expect(page).toMatch(/excludedDebtItemIds: \[\]/);
    expect(page).toMatch(/rankPayoffImpactsByPayment\(calc\?\.payoff_impacts/);
  });
});

describe("Debt-to-Income warnings, errors, and layout", () => {
  it("renders backend warnings and mutation errors", () => {
    expect(page).toMatch(/groupDtiWarnings/);
    expect(page).toMatch(/warning\.message/);
    expect(incomeModal).toMatch(/role="alert"/);
    expect(profileModal).toMatch(/role="alert"/);
    expect(page).toMatch(/Retry/);
  });

  it("uses mobile cards instead of a squeezed desktop table", () => {
    expect(page).toMatch(/hidden md:block/);
    expect(page).toMatch(/md:hidden/);
  });

  it("does not reimplement DTI formulas in the page or helpers", () => {
    expect(helpers).not.toMatch(/front_end.*=.*housing.*\/.*income/i);
    expect(helpers).not.toMatch(/back_end.*=.*\+.*debt.*\/.*income/i);
    expect(helpers).not.toMatch(/\/ income \* 100/);
  });
});
