import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  atPlanLimit,
  recurringRulesLimitReachedMessage,
  recurringRulesUsageLabel,
  recurringSaveConsumesActiveSlot,
} from "@budget-app/shared";
import type { BillingStatus } from "@budget-app/shared";

const dir = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(dir, "useRecurringPlanLimit.ts"), "utf8");
const listSource = readFileSync(join(dir, "RecurringListScreen.tsx"), "utf8");
const detailSource = readFileSync(join(dir, "RecurringDetailScreen.tsx"), "utf8");
const formSource = readFileSync(join(dir, "RecurringFormScreen.tsx"), "utf8");
const rowSource = readFileSync(join(dir, "RecurringRow.tsx"), "utf8");
const webRecurringSource = readFileSync(join(dir, "../../../web/src/pages/Recurring.tsx"), "utf8");

function mutationFnBlock(source: string): string {
  const start = source.indexOf("mutationFn: async");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("onSuccess:", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function resumeOnPressBlock(source: string): string {
  const label = source.indexOf('label="Resume recurrence"');
  expect(label).toBeGreaterThanOrEqual(0);
  const onPress = source.indexOf("onPress={() => {", label);
  expect(onPress).toBeGreaterThan(label);
  const close = source.indexOf("}}", onPress);
  return source.slice(onPress, close);
}

const freeAtLimit: BillingStatus = {
  plan: "FREE",
  is_premium: false,
  status: "inactive",
  cancel_at_period_end: false,
  current_period_end: null,
  has_stripe_customer: false,
  entitlements: {
    plan: "FREE",
    is_premium: false,
    plaid_bank_sync: false,
    payment_planner_full: false,
    limits: {
      linked_institutions: 0,
      manual_accounts: 3,
      recurring_rules: 10,
      operational_forecast_days: 90,
      goals: 2,
    },
    usage: {
      linked_institutions: 0,
      manual_accounts: 0,
      recurring_rules: 10,
      goals: 0,
    },
  },
};

const freeBelowLimit: BillingStatus = {
  ...freeAtLimit,
  entitlements: {
    ...freeAtLimit.entitlements!,
    usage: { ...freeAtLimit.entitlements!.usage, recurring_rules: 7 },
  },
};

const premiumStatus: BillingStatus = {
  ...freeAtLimit,
  plan: "PREMIUM",
  is_premium: true,
  status: "active",
  entitlements: {
    plan: "PREMIUM",
    is_premium: true,
    plaid_bank_sync: true,
    payment_planner_full: true,
    limits: {
      linked_institutions: null,
      manual_accounts: null,
      recurring_rules: null,
      operational_forecast_days: 365,
      goals: null,
    },
    usage: {
      linked_institutions: 1,
      manual_accounts: 5,
      recurring_rules: 11,
      goals: 4,
    },
  },
};

describe("mobile Recurring Free/Premium recurring-limit UX", () => {
  it("uses cached billing status and shared entitlement helpers, not a local plan or recount", () => {
    expect(hookSource).toMatch(/useBillingStatus/);
    expect(hookSource).toMatch(/atPlanLimit\(billing, "recurring_rules"\)/);
    expect(hookSource).toMatch(/recurringRulesUsageLabel\(billing\)/);
    expect(hookSource).toMatch(/recurringRulesLimitReachedMessage/);
    expect(hookSource).toMatch(/usePremiumUpgrade/);
    expect(hookSource).not.toMatch(/listRules/);
    expect(hookSource).not.toMatch(/recurringQueryKeys/);
    expect(hookSource).not.toMatch(/active === true/);
    expect(hookSource).not.toMatch(/paused_at/);
    expect(listSource).toMatch(/useRecurringPlanLimit/);
    expect(listSource).toMatch(/queryFn: \(\) => listRules\(\)/);
    expect(listSource.match(/queryFn: \(\) => listRules\(\)/g)?.length).toBe(1);
  });

  it("FREE below limit: usage label renders and + opens create", () => {
    expect(recurringRulesUsageLabel(freeBelowLimit)).toBe("7 of 10 active recurring rules");
    expect(atPlanLimit(freeBelowLimit, "recurring_rules")).toBe(false);
    expect(listSource).toMatch(/usageLabel/);
    expect(listSource).toMatch(/\{usageLabel\}/);
    expect(listSource).toMatch(/onAddRecurring/);
    expect(listSource).toMatch(/if \(interceptIfLimited\(\)\) return/);
    expect(listSource).toMatch(/router\.push\("\/recurring\/new"\)/);
    expect(listSource).not.toMatch(/onPress=\{\(\) => router\.push\("\/recurring\/new"\)\}/);
    expect(listSource).toMatch(/onPress=\{onAddRecurring\}/);
    expect(listSource).toMatch(/onAction=\{onAddRecurring\}/);
  });

  it("FREE below limit: resume is allowed", () => {
    expect(detailSource).toMatch(/useRecurringPlanLimit/);
    expect(hookSource).toMatch(/if \(!limited\) return false/);
    const resume = resumeOnPressBlock(detailSource);
    expect(resume).toMatch(/if \(interceptIfLimited\(\)\) return/);
    expect(resume).toMatch(/resumeMutation\.mutate/);
  });

  it("FREE at limit: + does not navigate and shows the upgrade prompt", () => {
    expect(atPlanLimit(freeAtLimit, "recurring_rules")).toBe(true);
    expect(recurringRulesUsageLabel(freeAtLimit)).toBe("10 of 10 active recurring rules");
    expect(recurringRulesLimitReachedMessage(freeAtLimit)).toBe(
      "You've reached the Free plan limit of 10 active recurring rules."
    );
    expect(hookSource).toMatch(/promptUpgrade\(RECURRING_LIMIT_TITLE/);
    expect(hookSource).toMatch(/You've reached the Free plan limit|recurringRulesLimitReachedMessage/);
    expect(listSource).toMatch(/onPress=\{onAddRecurring\}/);
    expect(listSource).not.toMatch(/onPress=\{\(\) => router\.push\("\/recurring\/new"\)\}/);
  });

  it("direct create route is blocked for active creation", () => {
    expect(formSource).toMatch(/!isEdit && limited && nextActive/);
    expect(formSource).toMatch(/Recurring limit reached/);
    expect(formSource).toMatch(/UPGRADE_TO_PREMIUM_LABEL/);
    expect(formSource).toMatch(/startUpgrade/);
    expect(formSource).toMatch(/createRule/);
    const mutationFn = mutationFnBlock(formSource);
    expect(mutationFn).toMatch(/recurringSaveConsumesActiveSlot/);
    expect(mutationFn).toMatch(/throw new Error\(limitReachedMessage\)/);
    expect(mutationFn.indexOf("recurringSaveConsumesActiveSlot")).toBeLessThan(
      mutationFn.indexOf("createRule")
    );
    expect(mutationFn.indexOf("limitReachedMessage")).toBeLessThan(mutationFn.indexOf("createRule"));
  });

  it("paused rules remain visible and Pause/Delete/Edit remain allowed at the limit", () => {
    expect(rowSource).toMatch(/lifecycleBadgeLabel/);
    expect(listSource).not.toMatch(/\.filter\(\(.*active/);
    expect(listSource).not.toMatch(/isActive === true/);
    expect(listSource).toMatch(/buildRecurringRows\(rulesQuery\.data\?\.results/);
    expect(detailSource).toMatch(/onPress=\{\(\) => pauseMutation\.mutate\(\)\}/);
    expect(detailSource).toMatch(/onPress=\{\(\) => setConfirmDelete\(true\)\}/);
    expect(detailSource).toMatch(/router\.push\(`\/recurring\/edit\/\$\{rule\.id\}`\)/);
    const pauseBlock = detailSource.slice(
      detailSource.indexOf('label="Pause recurrence"'),
      detailSource.indexOf("pauseMutation.mutate()")
    );
    expect(pauseBlock).not.toMatch(/interceptIfLimited/);
    const deleteBlock = detailSource.slice(
      detailSource.indexOf('label="Delete rule"'),
      detailSource.indexOf("setConfirmDelete(true)")
    );
    expect(deleteBlock).not.toMatch(/interceptIfLimited/);
  });

  it("FREE at limit: Resume is blocked and resume API is not called", () => {
    const resume = resumeOnPressBlock(detailSource);
    expect(resume).toMatch(/if \(interceptIfLimited\(\)\) return/);
    expect(resume).toMatch(/resumeMutation\.mutate/);
    expect(resume.indexOf("interceptIfLimited")).toBeLessThan(resume.indexOf("resumeMutation.mutate"));
  });

  it("create inactive is allowed when the active quota is full", () => {
    expect(
      recurringSaveConsumesActiveSlot({ isCreate: true, currentlyActive: false, nextActive: false })
    ).toBe(false);
    expect(formSource).toMatch(/lifecycleStatus: "running"/);
    expect(formSource).toMatch(/value: "paused"/);
    expect(formSource).toMatch(/recurringSaveConsumesActiveSlot/);
    expect(formSource).toMatch(/!isEdit && limited && nextActive/);
  });

  it("edit transitions match backend slot semantics", () => {
    expect(
      recurringSaveConsumesActiveSlot({ isCreate: false, currentlyActive: true, nextActive: true })
    ).toBe(false);
    expect(
      recurringSaveConsumesActiveSlot({ isCreate: false, currentlyActive: false, nextActive: true })
    ).toBe(true);
    expect(
      recurringSaveConsumesActiveSlot({ isCreate: false, currentlyActive: true, nextActive: false })
    ).toBe(false);
    expect(
      recurringSaveConsumesActiveSlot({ isCreate: false, currentlyActive: false, nextActive: false })
    ).toBe(false);
    expect(formSource).toMatch(/saveConsumesSlot && interceptIfLimited\(\)/);
    expect(formSource).toMatch(/updateRule/);
    expect(formSource).toMatch(/currentlyActive/);
  });

  it("PREMIUM has no quota interception for create or resume", () => {
    expect(atPlanLimit(premiumStatus, "recurring_rules")).toBe(false);
    expect(recurringRulesUsageLabel(premiumStatus)).toBeNull();
    expect(hookSource).toMatch(/if \(!limited\) return false/);
    expect(listSource).toMatch(/router\.push\("\/recurring\/new"\)/);
    expect(detailSource).toMatch(/resumeMutation\.mutate/);
  });

  it("quota uses billing-status usage with no extra recurring list fetch", () => {
    expect(hookSource).toMatch(/useBillingStatus/);
    expect(hookSource).not.toMatch(/listRules/);
    expect(hookSource).not.toMatch(/getRuleOccurrences/);
    expect(listSource.match(/listRules\(/g)?.length).toBe(1);
    expect(listSource).toMatch(/staleTime: 60_000/);
  });

  it("does not bring desktop Recurring summary cards or subscription intelligence to mobile", () => {
    expect(listSource).not.toMatch(/Active recurring rules/);
    expect(listSource).not.toMatch(/Monthly recurring obligations/);
    expect(listSource).not.toMatch(/Upcoming charges/);
    expect(listSource).not.toMatch(/Missed payments/);
    expect(listSource).not.toMatch(/Due soon/);
    expect(listSource).not.toMatch(/getSubscriptionIntelligence/);
    expect(listSource).not.toMatch(/getRecurringRulesSummary/);
    expect(listSource).not.toMatch(/getBillsOverview/);
  });
});

describe("web Recurring stays unchanged", () => {
  it("keeps richer desktop Recurring functionality", () => {
    expect(webRecurringSource).toMatch(/getRecurringRulesSummary/);
    expect(webRecurringSource).toMatch(/getSubscriptionIntelligence/);
    expect(webRecurringSource).toMatch(/Due soon/);
    expect(webRecurringSource).toMatch(/getBillsOverview/);
    expect(webRecurringSource).toMatch(/groupRecurringItemsByDay/);
    expect(webRecurringSource).toMatch(/AUTOMATION_PATH/);
  });
});
