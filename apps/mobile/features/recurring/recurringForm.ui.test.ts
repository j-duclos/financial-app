/**
 * Recurring view + Automation form UI contract tests.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const formSrc = readFileSync(join(here, "RecurringFormScreen.tsx"), "utf8");
const automationFormSrc = readFileSync(join(here, "../automation/AutomationFormScreen.tsx"), "utf8");
const listSrc = readFileSync(join(here, "RecurringListScreen.tsx"), "utf8");
const rowSrc = readFileSync(join(here, "RecurringRow.tsx"), "utf8");
const displaySrc = readFileSync(join(here, "recurringDisplay.ts"), "utf8");

describe("RecurringFormScreen is not a duplicate editor", () => {
  it("redirects create/edit to Automation", () => {
    expect(formSrc).toContain("Redirect");
    expect(formSrc).toContain("automationCreateHref");
    expect(formSrc).toContain("automationEditHref");
    expect(formSrc).not.toContain("createRule");
    expect(formSrc).not.toContain("OptionsPickerSheet");
  });
});

describe("AutomationFormScreen is the recurring-rule editor", () => {
  it("owns create/edit of recurring rules", () => {
    expect(automationFormSrc).toContain("createRule");
    expect(automationFormSrc).toContain("updateRule");
    expect(automationFormSrc).toContain("useAccountOptions");
    expect(automationFormSrc).toContain("useCategoryOptions");
    expect(automationFormSrc).toContain('direction: "EXPENSE"');
    expect(automationFormSrc).toContain('frequency: "MONTHLY_DAY"');
    expect(automationFormSrc).toContain('lifecycleStatus: "running"');
    expect(automationFormSrc).toContain("start_date: todayStr()");
    expect(automationFormSrc).not.toMatch(/Math.min\(31, Math.max\(1, Number\(v\) \|\| 1\)\)/);
    expect(automationFormSrc).toContain("draftDigits(v, 2)");
    expect(automationFormSrc).toContain("Enter a day of month between 1 and 31.");
    expect(automationFormSrc).toContain("SelectField");
    expect(automationFormSrc).toContain("OptionsPickerSheet");
    expect(automationFormSrc).toContain("category_id: form.category_id");
  });

  it("shows onboarding recurring help only with source=onboarding", () => {
    expect(automationFormSrc).toContain("isCalendarOnboardingSource(params.source)");
    expect(automationFormSrc).toContain('testID="onboarding-recurring-hint"');
    expect(automationFormSrc).toContain("GETTING_STARTED_COPY.recurringOnboardingHelp");
  });
});

describe("Recurring list UI structure", () => {
  it("uses compact rows with type, cadence, next occurrence, and status", () => {
    expect(rowSrc).not.toContain("width: 4");
    expect(rowSrc).toContain("CurrencyDisplay");
    expect(rowSrc).toContain("lifecycleBadgeLabel");
    expect(displaySrc).toContain("directionLabel(rule.direction)");
    expect(listSrc).not.toContain("getBillsOverview");
    expect(listSrc).toContain('useState<RecurringSortKey>("next")');
    expect(listSrc).toContain("Create automation");
    expect(listSrc).toContain("automationEditHref");
  });

  it("uses explicit pullRefreshing, not passive isFetching", () => {
    expect(listSrc).toMatch(/pullRefreshing/);
    expect(listSrc).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(listSrc).not.toMatch(/refreshing=\{\s*isFetching/);
    expect(listSrc).not.toMatch(/refreshing=\{isFetching && !isLoading\}/);
  });
});
