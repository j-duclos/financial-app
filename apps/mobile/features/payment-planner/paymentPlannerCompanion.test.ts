import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canUsePaymentPlannerFull,
  PAYMENT_PLANNER_FULL_UPSELL_BODY,
  PAYMENT_PLANNER_FULL_UPSELL_TITLE,
} from "@budget-app/shared";
import { BASELINE_PLANNER_INPUTS } from "./queryKeys";
import { paymentPlannerAccountPath } from "@/features/dashboard/navigation";

const dir = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(join(dir, "PaymentPlannerScreen.tsx"), "utf8");
const sheet = readFileSync(join(dir, "DebtDetailSheet.tsx"), "utf8");
const summary = readFileSync(join(dir, "PlannerSummaryCard.tsx"), "utf8");
const hooks = readFileSync(join(dir, "usePaymentPlannerData.ts"), "utf8");
const whatIf = readFileSync(join(dir, "WhatIfPanel.tsx"), "utf8");
const upsell = readFileSync(join(dir, "PremiumUpsellCard.tsx"), "utf8");
const details = readFileSync(join(dir, "PlanDetailsScreen.tsx"), "utf8");
const moreSource = readFileSync(join(dir, "../more/MoreScreen.tsx"), "utf8");
const accountDetail = readFileSync(join(dir, "../accounts/AccountDetailScreen.tsx"), "utf8");
const webPlanner = readFileSync(join(dir, "../../../../apps/web/src/pages/CreditCards.tsx"), "utf8");
const webNav = readFileSync(join(dir, "../../../../apps/web/src/lib/appNavigation.ts"), "utf8");

describe("mobile Payment Planner Free vs Premium companion", () => {
  it("uses backend billing entitlement, not a local plan system", () => {
    expect(screen).toMatch(/useBillingStatus/);
    expect(screen).toMatch(/canUsePaymentPlannerFull\(billing\)/);
    expect(canUsePaymentPlannerFull(undefined)).toBe(false);
    expect(hooks).toMatch(/getDebtPayoffPlan/);
    expect(hooks).not.toMatch(/for\s*\(.*months/);
  });

  it("FREE: summary, recommended next, and payoff order render without simulator controls", () => {
    expect(screen).toMatch(/PlannerSummaryCard/);
    expect(summary).toMatch(/Plan summary/);
    expect(summary).toMatch(/showExtraPayment/);
    expect(screen).toMatch(/showExtraPayment=\{plannerFull\}/);
    expect(screen).toMatch(/Recommended next/);
    expect(screen).toMatch(/Payoff order/);
    expect(screen).toMatch(/plannerFull \?/);
    expect(screen).toMatch(/StrategyModePanel/);
    expect(screen).toMatch(/WhatIfPanel/);
    expect(screen).toMatch(/Month-by-month projection/);
    expect(screen).toMatch(/PremiumUpsellCard/);
    expect(upsell).toMatch(/PAYMENT_PLANNER_FULL_UPSELL_TITLE/);
    expect(upsell).toMatch(/PAYMENT_PLANNER_FULL_UPSELL_BODY/);
    expect(PAYMENT_PLANNER_FULL_UPSELL_TITLE).toBe("Build a custom payoff plan");
    expect(PAYMENT_PLANNER_FULL_UPSELL_BODY).toMatch(/lump sums/);
  });

  it("FREE: does not execute Premium-only simulation queries", () => {
    expect(screen).toMatch(/if \(!plannerFull\) return BASELINE_PLANNER_INPUTS/);
    expect(BASELINE_PLANNER_INPUTS).toEqual({
      strategy: "avalanche",
      mode: "aggressive",
      extraMonthly: "0",
      lumpSum: "",
      lumpSumAccountId: null,
    });
    expect(screen).toMatch(/enabled: plannerFull && !!selectedAccount && !!selectedPlanCard/);
    expect(details).toMatch(/plannerFull && creditCards\.length > 0/);
    expect(screen).not.toMatch(/useAccountPayoffProjection\(\{[\s\S]*enabled: !!selectedAccount && !!selectedPlanCard/);
  });

  it("PREMIUM: keeps strategy, payoff mode, extra, lump, projection, and debt scenarios", () => {
    expect(screen).toMatch(/StrategyModePanel/);
    expect(screen).toMatch(/onStrategyChange=\{setStrategy\}/);
    expect(screen).toMatch(/onModeChange=\{setMode\}/);
    expect(whatIf).toMatch(/Adjust plan/);
    expect(whatIf).toMatch(/Extra per month/);
    expect(whatIf).toMatch(/One-time lump sum/);
    expect(whatIf).not.toMatch(/>What-If</);
    expect(screen).toMatch(/Month-by-month projection/);
    expect(sheet).toMatch(/plannerFull/);
    expect(sheet).toMatch(/Update scenario/);
    expect(sheet).toMatch(/DRAWER_PAYOFF_STRATEGY_OPTIONS/);
    expect(screen).toMatch(/useDebouncedValue/);
  });

  it("FREE debt detail is read-only basics; Premium may show custom scenarios", () => {
    expect(sheet).toMatch(/Payoff order \{planCard\.payoff_order\}/);
    expect(sheet).toMatch(/basicRecommendation/);
    expect(sheet).toMatch(/plannerFull \?/);
    expect(sheet).toMatch(/Custom monthly payment/);
    expect(sheet).toMatch(/if \(!plannerFull\) return/);
  });
});

describe("Payment Planner navigation and What-If scope", () => {
  it("credit account detail opens Payment Planner for Free and Premium", () => {
    expect(accountDetail).toMatch(/label="Payment Planner"/);
    expect(accountDetail).toMatch(/paymentPlannerAccountPath\(account\.id\)/);
    expect(accountDetail).not.toMatch(/canUsePaymentPlannerFull/);
    expect(accountDetail).not.toMatch(/is_premium/);
    expect(paymentPlannerAccountPath(9)).toEqual({
      pathname: "/payment-planner",
      params: { account: "9" },
    });
  });

  it("removes global What-If from mobile More and leaves web What-If unchanged", () => {
    expect(moreSource).not.toMatch(/title: "What-If"/);
    expect(moreSource).not.toMatch(/href: "\/what-if"/);
    expect(moreSource).toMatch(/title: "Payment Planner"/);
    expect(webNav).toMatch(/label: "What-If"/);
    expect(webPlanner).toMatch(/whatIfDebtPath/);
    expect(webPlanner).toMatch(/Strategy/);
    expect(webPlanner).toMatch(/Payoff mode|mode/);
  });
});
