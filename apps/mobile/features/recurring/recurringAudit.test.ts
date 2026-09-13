/**
 * Recurring view contract — list display plus legacy route redirects.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const detailSrc = readFileSync(join(here, "RecurringDetailScreen.tsx"), "utf8");
const formSrc = readFileSync(join(here, "RecurringFormScreen.tsx"), "utf8");
const listSrc = readFileSync(join(here, "RecurringListScreen.tsx"), "utf8");
const displaySrc = readFileSync(join(here, "recurringDisplay.ts"), "utf8");

describe("legacy Recurring create/detail routes", () => {
  it("redirects to the Automation rule editor instead of a second request graph", () => {
    expect(detailSrc).toContain("Redirect");
    expect(detailSrc).toContain("automationEditHref");
    expect(detailSrc).not.toContain("getRuleOccurrences");
    expect(detailSrc).not.toContain("getBillsOverview");
    expect(formSrc).toContain("Redirect");
    expect(formSrc).toContain("automationCreateHref");
    expect(formSrc).not.toContain("createRule");
    expect(listSrc).toContain("automationEditHref");
  });
});

describe("mobile recurringDisplay", () => {
  it("prefers next_occurrence_date and never generates recurrence", () => {
    expect(displaySrc).toContain("next_occurrence_date");
    expect(displaySrc).not.toMatch(/getNextRuleRunDate|generateRuleOccurrences|52\s*\/\s*12/);
  });

  it("includes income/expense/transfer type on the list meta line", () => {
    expect(displaySrc).toMatch(/directionLabel\(rule\.direction\)/);
  });
});
