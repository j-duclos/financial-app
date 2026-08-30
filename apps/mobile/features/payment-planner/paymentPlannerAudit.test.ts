/**
 * Payment Planner Audit Pass 1 — cross-cutting contracts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { paymentPlannerQueryKeys } from "./queryKeys";

const dir = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(join(dir, "PaymentPlannerScreen.tsx"), "utf8");
const whatIf = readFileSync(join(dir, "WhatIfPanel.tsx"), "utf8");
const hooks = readFileSync(join(dir, "usePaymentPlannerData.ts"), "utf8");
const display = readFileSync(join(dir, "display.ts"), "utf8");
const webPlanner = readFileSync(
  join(dir, "../../../../apps/web/src/pages/CreditCards.tsx"),
  "utf8"
);
const webKeys = readFileSync(
  join(dir, "../../../../apps/web/src/lib/paymentPlannerQueryKeys.ts"),
  "utf8"
);

describe("Payment Planner Audit Pass 1 contracts", () => {
  it("Web and Mobile both use neutral extra-monthly baseline", () => {
    expect(screen).toMatch(/NEUTRAL_EXTRA_MONTHLY\s*=\s*["']0["']/);
    expect(webPlanner).toMatch(/NEUTRAL_EXTRA_MONTHLY\s*=\s*["']0["']/);
    expect(screen).not.toMatch(/useState\(["']150["']\)/);
    expect(webPlanner).not.toMatch(/useState\(["']150["']\)/);
  });

  it("draft what-if edits do not appear in plan query construction", () => {
    expect(hooks).toMatch(/extra_monthly: inputs\.extraMonthly/);
    expect(whatIf).toMatch(/draftExtra/);
    expect(screen).toMatch(/appliedExtraMonthly/);
    // Screen only passes applied values into scenarioInputs
    expect(screen).toMatch(/extraMonthly: appliedExtraMonthly/);
  });

  it("query keys include every payoff-affecting scenario input", () => {
    const key = paymentPlannerQueryKeys.plan({
      strategy: "avalanche",
      mode: "aggressive",
      extraMonthly: "0",
      lumpSum: "500",
      lumpSumAccountId: 9,
    });
    expect(key).toEqual(["debt-plan", "avalanche", "aggressive", "0", "500", 9]);
    expect(webKeys).toMatch(/inputs\.extraMonthly/);
    expect(webKeys).toMatch(/inputs\.lumpSumAccountId/);
  });

  it("credit-card classification uses account_type metadata", () => {
    expect(display).toMatch(/account_type === ["']CREDIT["']/);
    expect(display).not.toMatch(/name\.includes\(["']card["']/i);
  });

  it("plan timeline is not reconstructed client-side", () => {
    expect(display).not.toMatch(/opening.?balance\s*-/i);
    expect(screen).toMatch(/plan\.timeline/);
  });

  it("AbortSignal is passed to payoff APIs", () => {
    expect(hooks).toMatch(/signal/);
    expect(hooks).toMatch(/\{ signal \}/);
  });
});
