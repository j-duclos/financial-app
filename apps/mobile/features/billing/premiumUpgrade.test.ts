import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCOUNTS_BANK_SYNC_TEASER,
  ACCOUNTS_LIMIT_TEASER,
  accountsLimitTeaser,
  MANAGE_SUBSCRIPTION_LABEL,
  premiumRequiredActionLabel,
  PREMIUM_BENEFITS,
  PREMIUM_DISCOVERY_SUBTITLE,
  PREMIUM_MONTHLY_PRICE_LABEL,
  PREMIUM_NOT_NOW_LABEL,
  PREMIUM_SHEET_TITLE,
  PREMIUM_UPGRADE_CONTEXT,
  PREMIUM_UPGRADE_CTA_LABEL,
} from "./premiumUpgradeCopy";

const dir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(dir, "../..");

function read(rel: string): string {
  return readFileSync(join(mobileRoot, rel), "utf8");
}

const copy = read("features/billing/premiumUpgradeCopy.ts");
const sheet = read("features/billing/PremiumUpgradeSheet.tsx");
const provider = read("features/billing/PremiumUpgradeProvider.tsx");
const hook = read("hooks/usePremiumUpgrade.ts");
const layout = read("app/(app)/_layout.tsx");
const accounts = read("features/accounts/AccountsScreen.tsx");
const forecast = read("features/dashboard/ForecastWindowSelect.tsx");
const recurringHook = read("features/recurring/useRecurringPlanLimit.ts");
const automationForm = read("features/automation/AutomationFormScreen.tsx");
const goalHook = read("features/goals/useGoalPlanLimit.ts");
const goalForm = read("features/goals/GoalFormScreen.tsx");
const reports = read("features/reports/ReportsScreen.tsx");
const reportDetail = read("features/reports/ReportDetailScreen.tsx");
const planner = read("features/payment-planner/PaymentPlannerScreen.tsx");
const planDetails = read("features/payment-planner/PlanDetailsScreen.tsx");
const profile = read("features/profile/ProfileSettingsScreen.tsx");
const more = read("features/more/MoreScreen.tsx");

describe("shared Premium upgrade copy", () => {
  it("uses $4.99/month and automatic bank syncing, not unlimited bank claims", () => {
    expect(PREMIUM_SHEET_TITLE).toBe("FlowSight Premium");
    expect(PREMIUM_MONTHLY_PRICE_LABEL).toBe("$4.99/month");
    expect(PREMIUM_UPGRADE_CTA_LABEL).toBe("Upgrade to Premium — $4.99/month");
    expect(PREMIUM_NOT_NOW_LABEL).toBe("Not now");
    expect(PREMIUM_BENEFITS).toEqual([
      "Automatic bank syncing",
      "365-day forecasts",
      "Unlimited manual accounts and recurring rules",
      "Advanced reports",
      "Full Payment Planner",
    ]);
    expect(copy).not.toMatch(/unlimited bank institutions/i);
    expect(copy).not.toMatch(/unlimited bank connections/i);
    expect(PREMIUM_BENEFITS.join(" ")).toMatch(/Automatic bank syncing/);
  });
});

describe("PremiumUpgradeSheet is the single upgrade surface", () => {
  it("hosts shared title, price, benefits, and CTAs", () => {
    expect(sheet).toMatch(/PREMIUM_SHEET_TITLE/);
    expect(sheet).toMatch(/PREMIUM_MONTHLY_PRICE_LABEL/);
    expect(sheet).toMatch(/PREMIUM_BENEFITS/);
    expect(sheet).toMatch(/PREMIUM_UPGRADE_CTA_LABEL/);
    expect(sheet).toMatch(/PREMIUM_NOT_NOW_LABEL/);
    expect(sheet).toMatch(/PREMIUM_AUTO_RENEW_STATEMENT/);
    expect(sheet).toMatch(/LegalInlineLinks prefix=\{PREMIUM_LEGAL_LINKS_PREFIX\}/);
    expect(sheet).toMatch(/purchaseAvailable/);
    expect(sheet).toMatch(/contextMessage/);
    expect(provider).toMatch(/PremiumUpgradeSheet/);
    expect(provider).toMatch(/if \(billing\?\.is_premium\) return/);
    expect(layout).toMatch(/PremiumUpgradeProvider/);
  });

  it("reuses createCheckoutSession and email verification", () => {
    expect(hook).toMatch(/createCheckoutSession/);
    expect(hook).toMatch(/createPortalSession/);
    expect(hook).toMatch(/isEmailVerificationRequiredError\(err\)/);
    expect(hook).toMatch(/EMAIL_VERIFY_BEFORE_UPGRADE_TITLE/);
    expect(hook).toMatch(/RESEND_VERIFICATION_EMAIL_LABEL/);
    expect(hook).toMatch(/logBillingCheckoutErrorIfDev\(err\)/);
    expect(hook).toMatch(/WebBrowser\.openBrowserAsync\(session\.url\)/);
    expect(provider).toMatch(/startUpgrade/);
    expect(provider).toMatch(/canOfferStripePremiumPurchase/);
    expect(hook).toMatch(/canUseStripeBilling/);
    expect(sheet).not.toMatch(/createCheckoutSession/);
  });
});

describe("screens open the shared sheet", () => {
  it("account limit and bank sync open the shared sheet", () => {
    expect(accounts).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.accounts\)/);
    expect(accounts).toMatch(/ACCOUNTS_BANK_SYNC_TEASER/);
    expect(accounts).toMatch(/accountsLimitTeaser\(canPurchase\)/);
    expect(accounts).not.toMatch(/manualAccountLimitReachedMessage/);
    expect(ACCOUNTS_BANK_SYNC_TEASER).toBe("Automatic bank syncing with Premium");
    expect(ACCOUNTS_LIMIT_TEASER).toMatch(/unlimited manual accounts and automatic bank syncing/);
    expect(premiumRequiredActionLabel(true)).toBe("Upgrade to Premium");
    expect(premiumRequiredActionLabel(false)).toBe("View plan");
    expect(accountsLimitTeaser(false)).not.toMatch(/^Upgrade /);
  });

  it("6 month / 1 year forecast opens the shared sheet", () => {
    expect(forecast).toMatch(/if \(row\.locked\)/);
    expect(forecast).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.forecast\)/);
    expect(forecast).not.toMatch(/lockedForecastUpsellMessage/);
    expect(PREMIUM_UPGRADE_CONTEXT.forecast).toBe("See your cash flow further ahead.");
  });

  it("recurring limit opens the shared sheet", () => {
    expect(recurringHook).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.recurring\)/);
    expect(automationForm).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.recurring\)/);
    expect(PREMIUM_UPGRADE_CONTEXT.recurring).toBe(
      "Create unlimited recurring rules with Premium."
    );
  });

  it("goal limit opens the shared sheet", () => {
    expect(goalHook).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.goals\)/);
    expect(goalForm).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.goals\)/);
    expect(PREMIUM_UPGRADE_CONTEXT.goals).toBe("Create unlimited goals with Premium.");
  });

  it("advanced Reports opens the shared sheet", () => {
    expect(reports).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.reports\)/);
    expect(reportDetail).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.reports\)/);
    expect(PREMIUM_UPGRADE_CONTEXT.reports).toBe("Unlock advanced reports and trends.");
  });

  it("Payment Planner Premium action opens the shared sheet", () => {
    expect(planner).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.paymentPlanner\)/);
    expect(planDetails).toMatch(/promptUpgrade\(PREMIUM_UPGRADE_CONTEXT\.paymentPlanner\)/);
    expect(PREMIUM_UPGRADE_CONTEXT.paymentPlanner).toBe("Unlock full payment planning.");
  });
});

describe("permanent discovery and Premium portal", () => {
  it("shows FlowSight Premium in Profile and More for Free users", () => {
    expect(profile).toMatch(/PREMIUM_SHEET_TITLE/);
    expect(profile).toMatch(/PREMIUM_DISCOVERY_SUBTITLE/);
    expect(profile).toMatch(/PREMIUM_MONTHLY_PRICE_LABEL/);
    expect(more).toMatch(/PREMIUM_SHEET_TITLE/);
    expect(more).toMatch(/PREMIUM_DISCOVERY_SUBTITLE/);
    expect(more).toMatch(/!isPremium/);
    expect(PREMIUM_DISCOVERY_SUBTITLE).toMatch(/Automatic bank sync/);
  });

  it("Premium users see Manage subscription and no upgrade CTA", () => {
    expect(profile).toMatch(/title="Premium"/);
    expect(profile).toMatch(/MANAGE_SUBSCRIPTION_LABEL/);
    expect(profile).toMatch(/startPortal/);
    expect(profile).not.toMatch(/title="Subscription"/);
    expect(hook).toMatch(/createPortalSession/);
    expect(MANAGE_SUBSCRIPTION_LABEL).toBe("Manage subscription");
    expect(provider).toMatch(/if \(billing\?\.is_premium\) return/);
  });
});
