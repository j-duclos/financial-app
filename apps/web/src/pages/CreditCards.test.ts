import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "CreditCards.tsx"), "utf8");

describe("Payment Planner URL mode", () => {
  it("initializes payoff mode from the mode query param for survival-plan deep links", () => {
    expect(source).toMatch(/parseDebtModeParam/);
    expect(source).toMatch(/searchParams\.get\("mode"\)/);
  });
});

describe("Payment Planner Audit Pass 1", () => {
  it("does not invent a $150 extra-monthly default", () => {
    expect(source).not.toMatch(/useState\(["']150["']\)/);
    expect(source).toMatch(/NEUTRAL_EXTRA_MONTHLY\s*=\s*["']0["']/);
  });

  it("debounces what-if extra/lump into the debt-plan query instead of an Update plan click", () => {
    expect(source).toMatch(/useDebouncedValue/);
    expect(source).toMatch(/WHAT_IF_NUMERIC_DEBOUNCE_MS/);
    expect(source).toMatch(/extraMonthly: debouncedExtraMonthly/);
    expect(source).toMatch(/paymentPlannerQueryKeys\.plan\(scenarioInputs\)/);
    expect(source).not.toMatch(/Update plan/);
    expect(source).not.toMatch(/draftExtraMonthly/);
    expect(source).not.toMatch(/Needs higher pay/);
    expect(source).toMatch(/PLANNER_SUMMARY_METRICS/);
  });

  it("requests CREDIT accounts via account_type filter", () => {
    expect(source).toMatch(/account_type:\s*["']CREDIT["']/);
  });

  it("shows empty state only after successful account load", () => {
    expect(source).toMatch(/accountsQuery\.isSuccess && creditCards\.length === 0/);
  });

  it("Apply-gates custom amount projection", () => {
    expect(source).toMatch(/appliedAmountInput/);
    expect(source).toMatch(/onApplyCustomAmount/);
  });
});
