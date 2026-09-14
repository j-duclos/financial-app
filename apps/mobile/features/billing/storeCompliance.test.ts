import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRIVACY_POLICY_URL, DEFAULT_TERMS_OF_SERVICE_URL } from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(dir, "../..");

function read(rel: string): string {
  return readFileSync(join(mobileRoot, rel), "utf8");
}

const hook = read("hooks/usePremiumUpgrade.ts");
const provider = read("features/billing/PremiumUpgradeProvider.tsx");
const sheet = read("features/billing/PremiumUpgradeSheet.tsx");
const upsell = read("features/payment-planner/PremiumUpsellCard.tsx");
const profile = read("features/profile/ProfileSettingsScreen.tsx");
const more = read("features/more/MoreScreen.tsx");
const firstRun = read("features/dashboard/DashboardFirstRun.tsx");
const reportDetail = read("features/reports/ReportDetailScreen.tsx");
const register = read("app/(auth)/register.tsx");
const config = read("app.config.ts");
const eas = read("eas.json");
const accounts = read("features/accounts/AccountsScreen.tsx");
const forecast = read("features/dashboard/ForecastWindowSelect.tsx");
const planner = read("features/payment-planner/PaymentPlannerScreen.tsx");
const goalForm = read("features/goals/GoalFormScreen.tsx");
const automationForm = read("features/automation/AutomationFormScreen.tsx");
const appJson = read("app.json");
const copy = read("features/billing/premiumUpgradeCopy.ts");

describe("iOS App Store billing compliance", () => {
  it("routes checkout and portal through the billing-provider gate", () => {
    expect(hook).toMatch(/canUseStripeBilling/);
    expect(hook).toMatch(/if \(!stripeAllowed\)/);
    expect(hook).toMatch(/PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE/);
    expect(hook).toMatch(/createCheckoutSession/);
    expect(hook).toMatch(/WebBrowser\.openBrowserAsync\(session\.url\)/);
    expect(provider).toMatch(/canOfferStripePremiumPurchase/);
    expect(provider).toMatch(/purchaseAvailable=\{purchaseAvailable\}/);
    expect(provider).toMatch(/if \(!purchaseAvailable\) return/);
  });

  it("hides the Stripe purchase CTA when purchase is unavailable", () => {
    expect(sheet).toMatch(/purchaseAvailable/);
    expect(sheet).toMatch(/PREMIUM_UPGRADE_CTA_LABEL/);
    expect(sheet).toMatch(/\{purchaseAvailable \? \(/);
    expect(sheet).toMatch(/PREMIUM_MANAGEMENT_UNAVAILABLE_MESSAGE/);
    expect(sheet).toMatch(/LegalInlineLinks/);
    expect(upsell).toMatch(/canOfferStripePremiumPurchase/);
    expect(upsell).toMatch(/premiumRequiredActionLabel\(canPurchase\)/);
    expect(more).toMatch(/canOfferStripePremiumPurchase/);
    expect(profile).toMatch(/canOfferStripePremiumPurchase/);
    expect(profile).toMatch(/canUseStripeBilling/);
    expect(firstRun).toMatch(/canOfferStripePremiumPurchase/);
    expect(reportDetail).toMatch(/canOfferStripePremiumPurchase/);
    expect(goalForm).toMatch(/canOfferStripePremiumPurchase/);
    expect(goalForm).toMatch(/premiumRequiredActionLabel\(canPurchase\)/);
    expect(automationForm).toMatch(/canOfferStripePremiumPurchase/);
    expect(automationForm).toMatch(/premiumRequiredActionLabel\(canPurchase\)/);
    expect(accounts).toMatch(/canOfferStripePremiumPurchase/);
    expect(accounts).toMatch(/accountsLimitTeaser\(canPurchase\)/);
  });

  it("keeps premium-required entry points on promptUpgrade", () => {
    expect(accounts).toMatch(/promptUpgrade/);
    expect(forecast).toMatch(/promptUpgrade/);
    expect(planner).toMatch(/promptUpgrade/);
    expect(profile).toMatch(/promptUpgrade/);
    expect(more).toMatch(/promptUpgrade/);
    expect(goalForm).toMatch(/promptUpgrade/);
    expect(automationForm).toMatch(/promptUpgrade/);
    expect(reportDetail).toMatch(/promptUpgrade/);
    expect(firstRun).toMatch(/onUpgrade/);
  });

  it("does not disable Premium status checks", () => {
    expect(provider).toMatch(/if \(billing\?\.is_premium\) return/);
    expect(profile).toMatch(/billing\?\.is_premium/);
    expect(more).toMatch(/billing\?\.is_premium === true/);
  });
});

describe("legal and store assets", () => {
  it("shows Terms and Privacy on registration", () => {
    expect(register).toMatch(/LegalInlineLinks/);
    expect(register).not.toMatch(/checkbox/i);
    expect(copy).toContain("By creating an account, you agree to the ");
  });

  it("uses centralized production legal URLs", () => {
    expect(DEFAULT_PRIVACY_POLICY_URL).toBe("https://flowsight360.com/privacy");
    expect(DEFAULT_TERMS_OF_SERVICE_URL).toBe("https://flowsight360.com/terms");
    expect(eas).toContain("https://flowsight360.com/privacy");
    expect(eas).toContain("https://flowsight360.com/terms");
    expect(config).toMatch(/DEFAULT_PRIVACY_POLICY_URL/);
    expect(config).toMatch(/DEFAULT_TERMS_OF_SERVICE_URL/);
  });

  it("points the store icon at the square PNG", () => {
    expect(config).toMatch(/IOS_STORE_ICON = "\.\/assets\/images\/icon\.png"/);
    expect(config).toMatch(/icon: IOS_STORE_ICON/);
    expect(config).not.toMatch(/icon: "\.\/assets\/branding\/flowsight-logo\.jpg"/);
    expect(config).toMatch(/APP_SPLASH_IMAGE = "\.\/assets\/images\/splash-icon\.png"/);
    expect(appJson).toMatch(/"icon": "\.\/assets\/images\/icon\.png"/);
    expect(appJson).toMatch(/"image": "\.\/assets\/images\/splash-icon\.png"/);
    expect(appJson).not.toMatch(/flowsight-logo\.jpg/);
  });
});
