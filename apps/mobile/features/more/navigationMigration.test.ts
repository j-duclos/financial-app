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
import { APP_WEB_URL } from "@budget-app/shared";

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

  it("Accounts still supports attention filter; Home View all uses Action Center", () => {
    expect(accountsAttentionFilterPath()).toEqual({
      pathname: "/(app)/(tabs)/accounts",
      params: { attention: "1" },
    });
    expect(accountsSource).toMatch(/attentionFilterActive/);
    expect(accountsSource).toMatch(/\/\(app\)\/\(tabs\)\/accounts/);
  });
});

describe("Spending Limits under More", () => {
  it("lists Reports under Insights & setup, not as a tab", () => {
    expect(moreSource).toMatch(/SectionHeader title="Insights & setup"/);
    const insightsBlock = moreSource.slice(
      moreSource.indexOf("const INSIGHTS_SETUP_LINKS"),
      moreSource.indexOf("const ACCOUNT_LINKS")
    );
    const moneyBlock = moreSource.slice(
      moreSource.indexOf("const MONEY_LINKS"),
      moreSource.indexOf("const PLANNING_LINKS")
    );
    expect(insightsBlock).toMatch(/title: "Reports"/);
    expect(insightsBlock).toMatch(/title: "Categories"/);
    expect(moneyBlock).not.toMatch(/title: "Reports"/);
  });

  it("lists Spending Limits in Planning (not as a tab)", () => {
    expect(moreSource).toMatch(/title: "Spending Limits"/);
    expect(moreSource).toMatch(/href: "\/spending-limits"/);
    expect(moreSource).toMatch(/SectionHeader title="Planning"/);
    expect(moreSource).toMatch(/title: "Goals"/);
    expect(moreSource).toMatch(/title: "Payment Planner"/);
    expect(moreSource).not.toMatch(/title: "What-If"/);
    expect(moreSource).not.toMatch(/href: "\/what-if"/);
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

describe("Account shortcuts on More", () => {
  it("adds Send feedback and FlowSight on the web after Profile, before log out", () => {
    expect(moreSource).toMatch(/SectionHeader title="Money tools"/);
    expect(moreSource).toMatch(/SectionHeader title="Planning"/);
    expect(moreSource).toMatch(/SectionHeader title="Insights & setup"/);
    expect(moreSource).toMatch(/SectionHeader title="Account"/);
    expect(moreSource).toMatch(/title="Send feedback"/);
    expect(moreSource).toMatch(/openFeedback/);
    expect(moreSource).toMatch(/title="FlowSight on the web"/);
    expect(moreSource).toMatch(/Open full web app/);
    expect(moreSource).toMatch(/Linking\.openURL\(APP_WEB_URL\)/);
    expect(APP_WEB_URL).toBe("https://flowsight360.com");
    expect(moreSource).toMatch(/FlowSight on the web, \$\{APP_WEB_HOST\}/);
    const moneyIdx = moreSource.indexOf('SectionHeader title="Money tools"');
    const accountIdx = moreSource.indexOf('SectionHeader title="Account"');
    const logoutIdx = moreSource.indexOf('label="Log out"');
    const planningIdx = moreSource.indexOf('SectionHeader title="Planning"');
    expect(planningIdx).toBeGreaterThan(moneyIdx);
    expect(accountIdx).toBeGreaterThan(planningIdx);
    expect(logoutIdx).toBeGreaterThan(accountIdx);
  });

  it("does not put the web shortcut inside feature categories", () => {
    const planningBlock = moreSource.slice(
      moreSource.indexOf("const PLANNING_LINKS"),
      moreSource.indexOf("const INSIGHTS_SETUP_LINKS")
    );
    const moneyBlock = moreSource.slice(
      moreSource.indexOf("const MONEY_LINKS"),
      moreSource.indexOf("const PLANNING_LINKS")
    );
    const insightsBlock = moreSource.slice(
      moreSource.indexOf("const INSIGHTS_SETUP_LINKS"),
      moreSource.indexOf("const ACCOUNT_LINKS")
    );
    expect(planningBlock).not.toMatch(/FlowSight on the web/);
    expect(moneyBlock).not.toMatch(/FlowSight on the web/);
    expect(insightsBlock).not.toMatch(/FlowSight on the web/);
    expect(moreSource).not.toMatch(/href: "\/what-if"/);
  });
});
