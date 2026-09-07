import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVITY_PREVIEW_ORDERING,
  ACTIVITY_PREVIEW_SIZE,
  hasAdditionalRuleActivity,
  historicalRuleActivityListParams,
  isHistoricalRuleActivityDate,
  previewHistoricalRuleActivity,
  transactionsForAutomationRule,
} from "./activityPreview";

const dir = dirname(fileURLToPath(import.meta.url));
const detailSource = readFileSync(join(dir, "AutomationDetailScreen.tsx"), "utf8");
const listSource = readFileSync(join(dir, "AutomationListScreen.tsx"), "utf8");
const summarySource = readFileSync(join(dir, "components/RuleSummaryCard.tsx"), "utf8");
const transactionsDataSource = readFileSync(
  join(dir, "../transactions/useTransactionsData.ts"),
  "utf8"
);

describe("automation activity preview helpers", () => {
  it("uses a 5-row historical preview, not a 25-row page", () => {
    expect(ACTIVITY_PREVIEW_SIZE).toBe(5);
    expect(historicalRuleActivityListParams(9, "2026-09-06")).toEqual({
      rule_id: 9,
      page: 1,
      page_size: 5,
      date_before: "2026-09-06",
      ordering: ACTIVITY_PREVIEW_ORDERING,
      show_reconciled: true,
    });
  });

  it("treats recent activity as date <= today and excludes future Planned rows", () => {
    expect(isHistoricalRuleActivityDate("2026-09-06", "2026-09-06")).toBe(true);
    expect(isHistoricalRuleActivityDate("2026-09-04", "2026-09-06")).toBe(true);
    expect(isHistoricalRuleActivityDate("2027-08-13", "2026-09-06")).toBe(false);

    const preview = previewHistoricalRuleActivity(
      [
        { id: 1, date: "2027-08-13", status: "PLANNED" },
        { id: 2, date: "2026-09-04", status: "CLEARED" },
        { id: 3, date: "2026-08-28", status: "CLEARED" },
        { id: 4, date: "2026-08-21", status: "CLEARED" },
        { id: 5, date: "2026-08-14", status: "CLEARED" },
        { id: 6, date: "2026-08-07", status: "CLEARED" },
        { id: 7, date: "2026-07-31", status: "CLEARED" },
        { id: 8, date: "2027-08-06", status: "PLANNED" },
      ],
      "2026-09-06"
    );

    expect(preview.map((row) => row.date)).toEqual([
      "2026-09-04",
      "2026-08-28",
      "2026-08-21",
      "2026-08-14",
      "2026-08-07",
    ]);
    expect(preview).toHaveLength(5);
    expect(preview.every((row) => row.status !== "PLANNED" || row.date <= "2026-09-06")).toBe(true);
  });

  it("orders recent activity newest historical first", () => {
    const preview = previewHistoricalRuleActivity(
      [
        { id: 10, date: "2026-08-07" },
        { id: 11, date: "2026-09-04" },
        { id: 12, date: "2026-08-21" },
      ],
      "2026-09-06"
    );
    expect(preview.map((row) => row.date)).toEqual(["2026-09-04", "2026-08-21", "2026-08-07"]);
  });

  it("detects additional history without expanding the preview page", () => {
    expect(hasAdditionalRuleActivity({ count: 5, next: null, results: [1, 2, 3, 4, 5] })).toBe(false);
    expect(hasAdditionalRuleActivity({ count: 12, next: "/next", results: [1, 2, 3, 4, 5] })).toBe(
      true
    );
  });

  it("navigates See all activity to Transactions filtered to the rule", () => {
    expect(
      transactionsForAutomationRule({
        ruleId: 9,
        accountId: 3,
        dateFrom: "2026-05-01",
        dateTo: "2026-09-06",
      })
    ).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: {
        account: "3",
        rule: "9",
        dateFrom: "2026-05-01",
        dateTo: "2026-09-06",
        showReconciled: "1",
      },
    });
    expect(transactionsDataSource).toMatch(/rule_id: filters\.ruleId/);
    expect(transactionsDataSource).toMatch(/filters\.ruleId != null/);
  });
});

describe("AutomationDetailScreen activity cleanup", () => {
  it("fetches a 5-row historical preview with a date_before cutoff", () => {
    expect(detailSource).toMatch(/ACTIVITY_PREVIEW_SIZE|historicalRuleActivityListParams/);
    expect(detailSource).toMatch(/date_before|historicalRuleActivityListParams/);
    expect(detailSource).toMatch(/todayStr\(\)/);
    expect(detailSource).not.toMatch(/HISTORY_PAGE_SIZE/);
    expect(detailSource).not.toMatch(/page_size:\s*25/);
    expect(detailSource).toMatch(/automationQueryKeys\.activityPreview\(ruleId, today\)/);
    expect(detailSource).toMatch(/automationQueryKeys\.detail\(ruleId\)/);
  });

  it("does not infinite-expand activity inside rule detail", () => {
    expect(detailSource).not.toMatch(/useInfiniteQuery/);
    expect(detailSource).not.toMatch(/Load more activity/);
    expect(detailSource).not.toMatch(/fetchNextPage/);
    expect(detailSource).toMatch(/See all activity/);
    expect(detailSource).toMatch(/transactionsForAutomationRule/);
  });

  it("keeps lifecycle actions after a short recent-activity preview", () => {
    expect(detailSource).toMatch(/label="Start"/);
    expect(detailSource).toMatch(/label="Next run"/);
    expect(detailSource).toMatch(/Pause rule/);
    expect(detailSource).toMatch(/Resume rule/);
    expect(detailSource).toMatch(/Delete rule/);
    expect(detailSource).toMatch(/RuleSummaryCard/);
  });

  it("removes raw Created and Updated timestamps from mobile detail", () => {
    expect(detailSource).not.toMatch(/label="Created"/);
    expect(detailSource).not.toMatch(/label="Updated"/);
    expect(detailSource).not.toMatch(/rule\.created_at/);
    expect(detailSource).not.toMatch(/rule\.updated_at/);
    expect(detailSource).toMatch(/label="Paused since"/);
    expect(detailSource).toMatch(/Scheduled change/);
  });

  it("does not add a future Planned list under Recent activity", () => {
    expect(detailSource).not.toMatch(/Upcoming/);
    expect(detailSource).toMatch(/previewHistoricalRuleActivity/);
    expect(detailSource).toMatch(/title="Recent activity"/);
  });

  it("keeps Rule Summary without duplicating trigger and action rows", () => {
    expect(summarySource).toMatch(/Rule summary/);
    expect(summarySource).toMatch(/buildRuleSummary/);
    expect(summarySource).not.toMatch(/Trigger: \{triggerSummary/);
    expect(summarySource).not.toMatch(/Action: \{actionSummary/);
  });

  it("does not redesign the Rules & Automation list", () => {
    expect(listSource).toMatch(/estimatedMonthlyCashFlow/);
    expect(listSource).toMatch(/Search/);
    expect(listSource).toMatch(/RULE_SECTIONS/);
  });
});
