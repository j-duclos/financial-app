import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accountsAttentionFilterPath,
  accountsTabPath,
} from "@/features/dashboard/navigation";
import { resolveRecommendationWebUrl } from "@/features/action-center/navigation";
import type { DashboardRecommendation } from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, "../..");

const tabsLayout = readFileSync(join(root, "app/(app)/(tabs)/_layout.tsx"), "utf8");
const moreSource = readFileSync(join(root, "features/more/MoreScreen.tsx"), "utf8");
const accountsSource = readFileSync(join(root, "features/accounts/AccountsScreen.tsx"), "utf8");
const accountDetailSource = readFileSync(
  join(root, "features/accounts/AccountDetailScreen.tsx"),
  "utf8"
);
const appLayout = readFileSync(join(root, "app/(app)/_layout.tsx"), "utf8");
const budgetTab = readFileSync(join(root, "app/(app)/(tabs)/budget.tsx"), "utf8");
const budgetIndex = readFileSync(join(root, "app/(app)/budget/index.tsx"), "utf8");
const accountsTab = readFileSync(join(root, "app/(app)/(tabs)/accounts.tsx"), "utf8");

const sampleRec = {
  id: 1,
  title: "Test",
  primary_action_url: null,
  secondary_action_url: null,
} as unknown as DashboardRecommendation;

describe("primary bottom navigation", () => {
  it("uses Home / Transactions / Calendar / Accounts / More", () => {
    expect(tabsLayout).toMatch(/title:\s*"Home"/);
    expect(tabsLayout).toMatch(/title:\s*"Transactions"/);
    expect(tabsLayout).toMatch(/title:\s*"Calendar"/);
    expect(tabsLayout).toMatch(/title:\s*"Accounts"/);
    expect(tabsLayout).toMatch(/title:\s*"More"/);
    expect(tabsLayout).not.toMatch(/title:\s*"Budget"/);
    expect(tabsLayout).toMatch(/name="accounts"/);
    expect(tabsLayout).toMatch(/name="budget"/);
    expect(tabsLayout).toMatch(/href:\s*null/);
  });

  it("Accounts is a true tab-root screen", () => {
    expect(accountsTab).toMatch(/AccountsScreen/);
    expect(accountsTabPath()).toBe("/(app)/(tabs)/accounts");
    // No secondary stack Accounts route
    expect(appLayout).not.toMatch(/name="accounts"/);
  });
});

describe("Accounts tab root", () => {
  it("has no Back button", () => {
    expect(accountsSource).toMatch(/title="Accounts"/);
    expect(accountsSource).not.toMatch(/showBack/);
    expect(accountsSource).not.toMatch(/onBack=/);
  });

  it("Account Detail keeps stack Back", () => {
    expect(accountDetailSource).toMatch(/onBack=\{\(\) => router\.back\(\)\}/);
  });

  it("attention View All opens Accounts tab with filter", () => {
    expect(accountsAttentionFilterPath()).toEqual({
      pathname: "/(app)/(tabs)/accounts",
      params: { attention: "1" },
    });
    expect(accountsSource).toMatch(/attentionFilterActive/);
    expect(accountsSource).toMatch(/\/\(app\)\/\(tabs\)\/accounts/);
  });
});

describe("Spending Limits under More", () => {
  it("lists Spending Limits in Planning (not as a tab)", () => {
    expect(moreSource).toMatch(/title: "Spending Limits"/);
    expect(moreSource).toMatch(/href: "\/spending-limits"/);
    expect(moreSource).toMatch(/SectionHeader title="Planning"/);
    expect(moreSource).toMatch(/title: "Goals"/);
    expect(moreSource).toMatch(/title: "Payment Planner"/);
    expect(moreSource).toMatch(/title: "What-If"/);
    expect(moreSource).not.toMatch(/href: "\/accounts"/);
  });

  it("legacy /budget routes redirect to Spending Limits", () => {
    expect(budgetTab).toMatch(/Redirect/);
    expect(budgetTab).toMatch(/\/spending-limits/);
    expect(budgetIndex).toMatch(/Redirect/);
    expect(budgetIndex).toMatch(/\/spending-limits/);
    expect(resolveRecommendationWebUrl("/budget", sampleRec)).toBe("/spending-limits");
    expect(resolveRecommendationWebUrl("/spending-goals", sampleRec)).toBe("/spending-limits");
  });
});
