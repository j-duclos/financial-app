import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const recurringSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Recurring.tsx"),
  "utf8"
);
const detailSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/recurring/RecurringDetailPanel.tsx"),
  "utf8"
);

describe("Recurring page", () => {
  it("exports Recurring component", async () => {
    const mod = await import("./Recurring");
    expect(typeof mod.default).toBe("function");
  });

  it("loads rules, checklist enrichment, and backend summary", () => {
    expect(recurringSource).toMatch(/listRules/);
    expect(recurringSource).toMatch(/getBillsOverview/);
    expect(recurringSource).toMatch(/getRecurringRulesSummary/);
  });

  it("waits for canonical summary and does not fall back to client totals", () => {
    expect(recurringSource).toMatch(/mapRecurringBackendSummary/);
    expect(recurringSource).toMatch(/SummaryBarSkeleton/);
    expect(recurringSource).toMatch(/Could not load recurring summary/);
    expect(recurringSource).toMatch(/summaryQuery\.refetch/);
    expect(recurringSource).not.toMatch(/computeRecurringSummary\(/);
    expect(recurringSource).not.toMatch(/aggregateRecurringSummaryFromItemsForTests/);
    // List may render independently of summary.
    expect(recurringSource).toMatch(/listLoading/);
    expect(recurringSource).toMatch(
      /listLoading = rulesQuery\.isLoading \|\| overviewQuery\.isLoading/
    );
  });

  it("detail panel uses targeted recurring invalidation", () => {
    expect(detailSource).toMatch(/invalidateRecurringRuleDependents/);
  });

  it("does not render forecast or risk banners", () => {
    expect(recurringSource).not.toMatch(/warnings\.map/);
    expect(recurringSource).not.toMatch(/overdraft/i);
    expect(recurringSource).not.toMatch(/months_after:\s*1/);
  });

  it("uses recurring health display helpers", () => {
    expect(recurringSource).toMatch(/recurringPaymentStatusLabel/);
    expect(recurringSource).toMatch(/RecurringDetailPanel/);
  });

  it("does not allow mark paid without matching a transaction", () => {
    expect(recurringSource).not.toMatch(/billMarkPaid/);
    expect(recurringSource).toMatch(/RecurringDetailPanel/);
  });

  it("pairs day sections in two columns on large screens", () => {
    expect(recurringSource).toMatch(/grid-cols-1 lg:grid-cols-2/);
    expect(recurringSource).toMatch(/groupRecurringItemsByDay/);
  });

  it("explains recurring versus rules and automation", () => {
    expect(recurringSource).toMatch(/RECURRING_PAGE_INTRO/);
    expect(recurringSource).toMatch(/AUTOMATION_PATH/);
    expect(detailSource).toMatch(/Manage automation/);
  });
});
