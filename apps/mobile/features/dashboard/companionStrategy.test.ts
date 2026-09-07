import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return readFileSync(join(mobileRoot, rel), "utf8");
}

describe("mobile debt remains discoverable off Home", () => {
  it("keeps account, reports, and payment-planner debt surfaces", () => {
    const accountDetail = read("features/accounts/AccountDetailScreen.tsx");
    const reports = read("features/reports/components/ReportSections.tsx");
    const planner = read("features/payment-planner/PaymentPlannerScreen.tsx");
    const more = read("features/more/MoreScreen.tsx");
    const homeHealth = read("features/dashboard/FinancialHealthSection.tsx");

    expect(accountDetail).toMatch(/kind === "credit"/);
    expect(reports).toMatch(/total_balance_owed|DebtSection|by_card/);
    expect(planner).toMatch(/useDebtPayoffPlan/);
    expect(more).toMatch(/Payment Planner/);
    expect(more).toMatch(/Reports/);
    expect(homeHealth).not.toMatch(/Total debt/);
    expect(homeHealth).not.toMatch(/Payment Planner/);
  });
});

describe("mobile companion navigation", () => {
  it("keeps Home, Transactions, Calendar, Accounts, and More as primary tabs", () => {
    const tabs = read("app/(app)/(tabs)/_layout.tsx");
    expect(tabs).toMatch(/title: "Home"/);
    expect(tabs).toMatch(/title: "Transactions"/);
    expect(tabs).toMatch(/title: "Calendar"/);
    expect(tabs).toMatch(/title: "Accounts"/);
    expect(tabs).toMatch(/title: "More"/);
    expect(tabs).not.toMatch(/title: "Reports"/);
    expect(tabs).not.toMatch(/title: "Payment Planner"/);
    expect(tabs).not.toMatch(/title: "Goals"/);
    expect(tabs).not.toMatch(/title: "What-If"/);
  });
});

describe("deferred Recurring entitlement UX", () => {
  it("still offers unlimited-looking create actions; backend remains the guard", () => {
    const recurring = read("features/recurring/RecurringListScreen.tsx");
    expect(recurring).toMatch(/Add recurring/);
    expect(recurring).not.toMatch(/atPlanLimit/);
  });
});
