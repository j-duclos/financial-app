import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  FINANCIAL_QUERY_PREFIXES,
  LIVE_QUERY_KEY_ROOTS,
  OBSOLETE_INVALIDATION_PREFIXES,
  invalidateAfterAccountFinancialMutation,
  invalidateAfterAccountMetadataEdit,
  invalidateAfterReconcileMutation,
  invalidateAfterUtilizationTargetChange,
  invalidateRecurringRuleDependents,
  invalidateSpendingTargetDependents,
  refreshAfterTransactionCategoryEdit,
  refreshAfterTransactionEdit,
} from "@/lib/financialQueryRefresh";
import { referenceQueryKeys } from "@/lib/referenceQueryKeys";
import { actionCenterQueryKeys } from "@/features/action-center/queryKeys";
import { accountQueryKeys } from "@/features/accounts/queryKeys";
import { budgetQueryKeys } from "@/features/budget/queryKeys";
import { calendarQueryKeys } from "@/features/calendar/queryKeys";
import { categoriesQueryKeys } from "@/features/categories/queryKeys";
import { goalsQueryKeys } from "@/features/goals/queryKeys";
import { paymentPlannerQueryKeys } from "@/features/payment-planner/queryKeys";
import { reconcileQueryKeys } from "@/features/reconcile/queryKeys";
import { recurringQueryKeys } from "@/features/recurring/queryKeys";
import { reportsQueryKeys } from "@/features/reports/queryKeys";
import { transactionQueryKeys } from "@/features/transactions/queryKeys";
import { whatIfQueryKeys } from "@/features/what-if/queryKeys";

const root = dirname(fileURLToPath(import.meta.url));
const financialRefreshSource = readFileSync(join(root, "financialQueryRefresh.ts"), "utf8");

function invalidatedRoots(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => {
    const key = (c[0] as { queryKey: unknown }).queryKey;
    return Array.isArray(key) ? String(key[0]) : String(key);
  });
}

describe("live query-key inventory", () => {
  it("maps canonical factories to known live roots", () => {
    expect(transactionQueryKeys.all[0]).toBe(LIVE_QUERY_KEY_ROOTS.transactions);
    expect(transactionQueryKeys.timeline({})[0]).toBe(LIVE_QUERY_KEY_ROOTS.timeline);
    expect(referenceQueryKeys.accountOptions(1)[0]).toBe(LIVE_QUERY_KEY_ROOTS.accountOptions);
    expect(referenceQueryKeys.categoryOptions(1)[0]).toBe(LIVE_QUERY_KEY_ROOTS.categoryOptions);
    expect(calendarQueryKeys.summary({} as never)[0]).toBe(LIVE_QUERY_KEY_ROOTS.calendarSummary);
    expect(calendarQueryKeys.chunk({} as never, "a", "b")[0]).toBe(LIVE_QUERY_KEY_ROOTS.calendarChunk);
    expect(accountQueryKeys.mainList()[0]).toBe(LIVE_QUERY_KEY_ROOTS.accounts);
    expect(accountQueryKeys.balanceDetail(1)[0]).toBe(LIVE_QUERY_KEY_ROOTS.account);
    expect(actionCenterQueryKeys.recommendations(30)[0]).toBe(LIVE_QUERY_KEY_ROOTS.recommendations);
    expect(recurringQueryKeys.all[0]).toBe(LIVE_QUERY_KEY_ROOTS.rules);
    expect(recurringQueryKeys.billsOverview("2026-01")[0]).toBe(LIVE_QUERY_KEY_ROOTS.billsOverview);
    expect(budgetQueryKeys.targets(null, "m", "a")[0]).toBe(LIVE_QUERY_KEY_ROOTS.spendingTargets);
    expect(budgetQueryKeys.summary(null, "m", "a")[0]).toBe(
      LIVE_QUERY_KEY_ROOTS.spendingTargetsSummary
    );
    expect(budgetQueryKeys.targetDetail(1, "a")[0]).toBe(LIVE_QUERY_KEY_ROOTS.spendingTarget);
    expect(goalsQueryKeys.overview(1)[0]).toBe(LIVE_QUERY_KEY_ROOTS.buckets);
    expect(goalsQueryKeys.detail(1)[0]).toBe(LIVE_QUERY_KEY_ROOTS.bucketDetail);
    expect(reportsQueryKeys.monthly("2026-01", 1, 6)[0]).toBe(LIVE_QUERY_KEY_ROOTS.monthlyReports);
    expect(paymentPlannerQueryKeys.plan({} as never)[0]).toBe(LIVE_QUERY_KEY_ROOTS.debtPlan);
    expect(reconcileQueryKeys.all[0]).toBe(LIVE_QUERY_KEY_ROOTS.reconcile);
    expect(categoriesQueryKeys.all[0]).toBe(LIVE_QUERY_KEY_ROOTS.categories);
    expect(whatIfQueryKeys.scenarios[0]).toBe(LIVE_QUERY_KEY_ROOTS.whatIfScenarios);
  });

  it("logout prefixes cover live financial roots without what-if scenario keys", () => {
    const flat = FINANCIAL_QUERY_PREFIXES.map((k) => k[0]);
    expect(flat).toContain("transactions");
    expect(flat).toContain("accounts");
    expect(flat).not.toContain("what-if-scenarios");
    for (const obsolete of OBSOLETE_INVALIDATION_PREFIXES) {
      expect(flat).not.toContain(obsolete);
    }
  });
});

describe("obsolete invalidation guard", () => {
  it("mutation helpers do not reference dead prefixes", () => {
    for (const obsolete of OBSOLETE_INVALIDATION_PREFIXES) {
      expect(financialRefreshSource).not.toMatch(new RegExp(`\\["${obsolete}"\\]`));
    }
  });
});

describe("transaction mutation invalidation", () => {
  it("full edit invalidates ledger and forecast but not rules or goals", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    refreshAfterTransactionEdit(queryClient);
    const roots = invalidatedRoots(spy);
    expect(roots).toEqual(
      expect.arrayContaining(["transactions", "timeline", "accounts", "dashboard-summary-fast"])
    );
    expect(roots).not.toContain("rules");
    expect(roots).not.toContain("buckets");
    expect(roots).not.toContain("account-options");
    expect(roots).not.toContain("what-if-scenarios");
    spy.mockRestore();
  });

  it("category-only edit skips forecast and ledger rebuild", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    refreshAfterTransactionCategoryEdit(queryClient);
    const roots = invalidatedRoots(spy);
    expect(roots).toContain("transactions");
    expect(roots).toContain("spending-targets");
    expect(roots).toContain("monthly-reports");
    expect(roots).not.toContain("timeline");
    expect(roots).not.toContain("calendar-summary");
    expect(roots).not.toContain("accounts");
    spy.mockRestore();
  });

  it("transaction mutations use invalidate only — no layered refetch", () => {
    expect(financialRefreshSource).toMatch(/export function refreshAfterTransactionEdit/);
    const fnBody = financialRefreshSource.slice(
      financialRefreshSource.indexOf("export function refreshAfterTransactionEdit"),
      financialRefreshSource.indexOf("export function invalidateRecurringRuleDependents")
    );
    expect(fnBody).not.toMatch(/refetchQueries/);
  });
});

describe("spending limit mutation invalidation", () => {
  it("does not invalidate timeline, calendar, accounts, rules, goals, or reconcile", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateSpendingTargetDependents(queryClient);
    const roots = invalidatedRoots(spy);
    expect(roots).toEqual(
      expect.arrayContaining([
        "spending-targets",
        "spending-targets-summary",
        "spending-target",
        "spending-target-edit",
        "dashboard-summary-fast",
        "recommendations",
        "monthly-reports",
      ])
    );
    expect(roots).not.toContain("timeline");
    expect(roots).not.toContain("calendar-summary");
    expect(roots).not.toContain("accounts");
    expect(roots).not.toContain("rules");
    expect(roots).not.toContain("buckets");
    expect(roots).not.toContain("reconcile");
    spy.mockRestore();
  });
});

describe("account mutation invalidation", () => {
  it("create/archive refreshes account-options immediately", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAfterAccountFinancialMutation(queryClient);
    expect(invalidatedRoots(spy)).toContain("account-options");
    spy.mockRestore();
  });

  it("metadata-only edit refreshes account-options without timeline", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAfterAccountMetadataEdit(queryClient);
    const roots = invalidatedRoots(spy);
    expect(roots).toContain("account-options");
    expect(roots).not.toContain("timeline");
    spy.mockRestore();
  });

  it("utilization target change skips account-options", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAfterUtilizationTargetChange(queryClient);
    const roots = invalidatedRoots(spy);
    expect(roots).toContain("accounts");
    expect(roots).not.toContain("account-options");
    spy.mockRestore();
  });
});

describe("recurring rule mutation invalidation", () => {
  it("targets forecast dependents without historical-only reports blanket", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateRecurringRuleDependents(queryClient);
    const roots = invalidatedRoots(spy);
    expect(roots).toEqual(
      expect.arrayContaining([
        "rules",
        "timeline",
        "calendar-chunk",
        "buckets",
        "what-if-scenarios",
      ])
    );
    expect(roots).not.toContain("spending-targets");
    expect(roots).not.toContain("reconcile");
    spy.mockRestore();
  });
});

describe("reconcile mutation invalidation", () => {
  it("refreshes reconcile and transactions without forecast rebuild", () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    invalidateAfterReconcileMutation(queryClient);
    const roots = invalidatedRoots(spy);
    expect(roots).toEqual(
      expect.arrayContaining(["reconcile", "transactions", "account", "monthly-reports"])
    );
    expect(roots).not.toContain("timeline");
    expect(roots).not.toContain("dashboard-summary-fast");
    expect(roots).not.toContain("reconcile-setup");
    spy.mockRestore();
  });
});
