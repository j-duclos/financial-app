import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const layoutSource = readFileSync(join(dir, "../components/Layout.tsx"), "utf8");
const dashboardSource = readFileSync(join(dir, "Dashboard.tsx"), "utf8");
const accountsSource = readFileSync(join(dir, "Accounts.tsx"), "utf8");
const transactionsSource = readFileSync(join(dir, "Transactions.tsx"), "utf8");
const recurringSource = readFileSync(join(dir, "Recurring.tsx"), "utf8");
const rulesSource = readFileSync(join(dir, "Rules.tsx"), "utf8");

describe("first-run onboarding wiring", () => {
  it("shows welcome from onboarding status and dismisses on skip", () => {
    expect(layoutSource).toMatch(/OnboardingWelcomeModal/);
    expect(layoutSource).toMatch(/shouldShowOnboardingWelcome/);
    expect(layoutSource).toMatch(/dismissMu\.mutate/);
    expect(layoutSource).toMatch(/onGetStarted=\{\(\) => setWelcomeAcked\(true\)\}/);
  });

  it("uses Dashboard first-run empty state instead of $0 forecast tiles", () => {
    expect(dashboardSource).toMatch(/dashboard-first-run/);
    expect(dashboardSource).toMatch(/Build your first forecast/);
    expect(dashboardSource).toMatch(/isMissingAccounts/);
    expect(dashboardSource).toMatch(/OnboardingChecklist/);
    expect(dashboardSource).not.toMatch(/isDashboardOnboarding/);
    expect(dashboardSource).toMatch(/Add account manually/);
    expect(dashboardSource).toMatch(/FREE_PLAN_LIMITS\.manual_accounts/);
  });

  it("replaces the Accounts blank list with a useful empty state", () => {
    expect(accountsSource).toMatch(/No accounts yet/);
    expect(accountsSource).toMatch(/Add account manually/);
    expect(accountsSource).toMatch(/searchParams\.get\("new"\) !== "1"/);
    expect(accountsSource).toMatch(/MANUAL_ACCOUNT_HELP/);
    expect(accountsSource).not.toMatch(/Add your first account or link a bank/);
  });

  it("keeps a Free-user manual path and Premium connect CTA", () => {
    expect(accountsSource).toMatch(/Upgrade for automatic bank syncing/);
    expect(accountsSource).toMatch(/Connect bank/);
    expect(dashboardSource).toMatch(/Connect bank/);
    expect(transactionsSource).not.toMatch(/Link a bank/);
  });

  it("shows Transactions empty states without fake rows", () => {
    expect(transactionsSource).toMatch(/transactions-empty-state/);
    expect(transactionsSource).toMatch(/No transactions yet/);
    expect(transactionsSource).toMatch(/Add transaction/);
    expect(transactionsSource).not.toMatch(/placeholder fake/);
  });

  it("shows Recurring empty state with income and bill actions", () => {
    expect(recurringSource).toMatch(/No recurring income or bills yet/);
    expect(recurringSource).toMatch(/Add income/);
    expect(recurringSource).toMatch(/Add bill/);
    expect(recurringSource).toMatch(/\/automation\?new=income/);
    expect(recurringSource).not.toMatch(/Add a recurring rule/);
  });

  it("opens automation create from onboarding query params", () => {
    expect(rulesSource).toMatch(/searchParams\.get\("new"\)/);
    expect(rulesSource).toMatch(/direction: "INCOME"/);
    expect(rulesSource).toMatch(/is_bill: true/);
    expect(rulesSource).toMatch(/RECURRING_HELP/);
  });
});
