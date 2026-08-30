/**
 * Recurring Audit Pass 1 — Mobile Detail / list contract tests.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const detailSrc = readFileSync(join(here, "RecurringDetailScreen.tsx"), "utf8");
const displaySrc = readFileSync(join(here, "recurringDisplay.ts"), "utf8");

describe("RecurringDetailScreen request graph", () => {
  it("uses bounded getRuleOccurrences instead of household bills overview", () => {
    expect(detailSrc).toContain("getRuleOccurrences");
    expect(detailSrc).toMatch(/occurrence_limit|limit:\s*5/);
    expect(detailSrc).not.toContain("getBillsOverview");
    expect(detailSrc).not.toMatch(/months_after:\s*2/);
  });

  it("resolves next occurrence from backend fields only", () => {
    expect(detailSrc).toContain("resolveNextOccurrence");
    expect(detailSrc).not.toMatch(/getNextRuleRunDate|generateRuleOccurrences/);
  });
});

describe("mobile recurringDisplay", () => {
  it("prefers next_occurrence_date and never generates recurrence", () => {
    expect(displaySrc).toContain("next_occurrence_date");
    expect(displaySrc).not.toMatch(/getNextRuleRunDate|generateRuleOccurrences|52\s*\/\s*12/);
  });
});
