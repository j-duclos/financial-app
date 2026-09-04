import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(join(dir, "PaymentPlannerScreen.tsx"), "utf8");
const strategyPanel = readFileSync(join(dir, "StrategyModePanel.tsx"), "utf8");
const whatIf = readFileSync(join(dir, "WhatIfPanel.tsx"), "utf8");
const debtRow = readFileSync(join(dir, "DebtPriorityRow.tsx"), "utf8");
const sheet = readFileSync(join(dir, "DebtDetailSheet.tsx"), "utf8");
const summary = readFileSync(join(dir, "PlannerSummaryCard.tsx"), "utf8");
const hooks = readFileSync(join(dir, "usePaymentPlannerData.ts"), "utf8");
const display = readFileSync(join(dir, "display.ts"), "utf8");
const navigation = readFileSync(join(dir, "navigation.ts"), "utf8");

describe("Payment Planner mobile UI structure", () => {
  it("uses strategy/mode selectors instead of permanent chip walls", () => {
    expect(strategyPanel).toContain("OptionsPickerSheet");
    expect(strategyPanel).toContain("SelectField");
    expect(strategyPanel).not.toContain("borderRadius: 999");
    expect(screen).not.toMatch(/ChipRow/);
  });

  it("applies what-if extra/lump as you type after debounce", () => {
    expect(whatIf).toContain("Extra per month");
    expect(whatIf).toContain("onExtraMonthlyChange");
    expect(screen).toMatch(/onExtraMonthlyChange=\{setExtraMonthly\}/);
    expect(screen).toMatch(/debouncedExtraMonthly/);
    expect(whatIf).not.toMatch(/draftExtra/);
  });

  it("does not invent a $150 extra-monthly default", () => {
    expect(screen).not.toMatch(/useState\(["']150["']\)/);
    expect(screen).toMatch(/NEUTRAL_EXTRA_MONTHLY\s*=\s*["']0["']/);
  });

  it("uses explicit pullRefreshing, not passive isRefetching", () => {
    expect(screen).toMatch(/pullRefreshing/);
    expect(screen).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(screen).not.toMatch(/refreshing=\{planQuery\.isRefetching/);
  });

  it("shows empty state only after successful account confirmation", () => {
    expect(screen).toMatch(/accountsQuery\.isSuccess && creditCards\.length === 0/);
    expect(screen).toMatch(/accountsQuery\.isError/);
  });

  it("filters accounts by CREDIT account_type at the API", () => {
    expect(hooks).toMatch(/account_type:\s*["']CREDIT["']/);
  });

  it("ranks recommended next debt from backend payoff_order", () => {
    expect(screen).toMatch(/payoff_order === 1/);
  });

  it("keeps payoff rows compact without utilization bars by default", () => {
    expect(debtRow).toContain("debtRowMetaLine");
    expect(debtRow).not.toContain("UtilizationDisplay");
    expect(debtRow).not.toContain("Interest/mo");
    expect(debtRow).not.toContain("credit_limit");
  });

  it("opens scenario on row tap and navigates account/ledger with account id", () => {
    expect(screen).toContain("DebtDetailSheet");
    expect(screen).toContain("setSelectedAccountId");
    expect(sheet).toContain("accountDetailPath(account.id)");
    expect(sheet).toContain("transactionsForAccountPath(account.id");
    expect(sheet).toContain("View ledger");
    expect(navigation).toContain('pathname: "/(app)/(tabs)/transactions"');
  });

  it("navigates month-by-month via plan-details route", () => {
    expect(screen).toContain("Month-by-month projection");
    expect(screen).toContain("planDetailsPath()");
  });

  it("never pipes pre-formatted currency into CurrencyDisplay in summary", () => {
    expect(summary).not.toContain("CurrencyDisplay");
    expect(summary).toContain("formatMoneyOrDash");
  });

  it("never renders literal NaN helpers without guards", () => {
    expect(display).toContain("formatMoneyOrDash");
    expect(display).toMatch(/Number\.isFinite/);
  });
});

describe("Payment Planner performance structure", () => {
  it("fetches one household plan from the server", () => {
    expect(hooks).toContain("getDebtPayoffPlan");
    expect(hooks).toContain("useDebtPayoffPlan");
    expect(screen).toMatch(/useDebtPayoffPlan\(scenarioInputs/);
  });

  it("does not run client-side payoff simulation loops", () => {
    expect(display).not.toMatch(/for\s*\(.*months/);
    expect(screen).not.toMatch(/project_credit_card_payoff|simulate_household/);
    expect(hooks).not.toMatch(/while\s*\(/);
  });

  it("reuses accounts list and only loads per-card payoff in the scenario sheet", () => {
    expect(hooks).toContain("listAccounts");
    expect(hooks).toContain("getAccountPayoff");
    expect(screen).toContain("useAccountPayoffProjection");
    // Scenario projection is gated on selected account — not per debt card on the list.
    expect(screen).toMatch(/enabled: !!selectedAccount && !!selectedPlanCard/);
  });

  it("debounces scenario updates rather than per keystroke on the plan", () => {
    expect(screen).toContain("useDebouncedValue");
    expect(whatIf).not.toContain("Update plan");
    expect(sheet).toContain("Update scenario");
  });
});
