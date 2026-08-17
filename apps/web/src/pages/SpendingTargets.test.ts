import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "SpendingTargets.tsx"),
  "utf8"
);

describe("Budget page", () => {
  it("loads batched summary data rather than per-card requests", () => {
    expect(source).toMatch(/getSpendingTargetsSummary/);
    expect(source).toMatch(/listSpendingTargets/);
    expect(source).not.toMatch(/listTransactions/);
    expect(source).not.toMatch(/getRecommendations/);
  });

  it("keeps the top summary math on canonical totals", () => {
    expect(source).toMatch(/Known upcoming/);
    expect(source).toMatch(/spendingTargetsRemainingFromSummary/);
    expect(source).toMatch(/summary\.scheduled_in_period_total/);
    expect(source).toMatch(/summary\.spent_so_far_total/);
    expect(source).toMatch(/summary\.total_monthly_targets/);
  });

  it("does not add sorting or filtering controls", () => {
    expect(source).not.toMatch(/sortBy/);
    expect(source).not.toMatch(/filterCategory/);
  });

  it("uses a short subtitle, keeps progress copy, and labels the add CTA", () => {
    expect(source).toMatch(/Set and track monthly spending by category\./);
    expect(source).toMatch(/Progress uses posted spending plus known future scheduled transactions only\./);
    expect(source).not.toMatch(/Monthly category budget from posted spending/);
    expect(source).not.toMatch(/Set a monthly budget per category\./);
    expect(source).toMatch(/Add spending limit/);
    expect(source).not.toMatch(/>\s*Add limit\s*</);
  });
});
