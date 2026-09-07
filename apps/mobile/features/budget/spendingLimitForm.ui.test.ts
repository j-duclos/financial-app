import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const formSrc = readFileSync(join(dir, "SpendingLimitFormScreen.tsx"), "utf8");
const formHelpersSrc = readFileSync(join(dir, "spendingLimitForm.ts"), "utf8");
const listSrc = readFileSync(join(dir, "SpendingLimitsScreen.tsx"), "utf8");
const rowSrc = readFileSync(join(dir, "BudgetCategoryRow.tsx"), "utf8");
const displaySrc = readFileSync(join(dir, "spendingTargetDisplay.ts"), "utf8");
const webFormSrc = readFileSync(
  join(dir, "../../../web/src/components/spendingTargets/SpendingTargetFormModal.tsx"),
  "utf8"
);

describe("SpendingLimitFormScreen category picker", () => {
  it("uses SelectField + OptionsPickerSheet instead of a category chip wall", () => {
    expect(formSrc).toMatch(/SelectField/);
    expect(formSrc).toMatch(/label="Category"/);
    expect(formSrc).toMatch(/OptionsPickerSheet/);
    expect(formSrc).toMatch(/setCategoryPickerOpen\(true\)/);
    expect(formSrc).toMatch(/visible=\{categoryPickerOpen\}/);
    expect(formSrc).toMatch(/searchPlaceholder="Search categories"/);
    expect(formSrc).toMatch(/spendingLimitCategoryPickerOptions/);
    expect(formSrc).not.toMatch(/options=\{expenseCategories\.map/);
    expect(formSrc).not.toMatch(/label="Category"[\s\S]{0,200}flexWrap:\s*"wrap"/);
  });

  it("loads expense categories once and searches locally", () => {
    const categoryOptionCalls = formSrc.match(/useCategoryOptions\(/g) ?? [];
    expect(categoryOptionCalls.length).toBe(1);
    expect(formSrc).toMatch(/type: "EXPENSE"/);
    expect(formSrc).not.toMatch(/listCategories\(/);
  });

  it("locks category on edit with a disabled field, not a disabled chip collection", () => {
    expect(formSrc).toMatch(/disabled=\{isEdit\}/);
    expect(formSrc).toMatch(/Category cannot be changed after creating a limit\./);
  });
});

describe("SpendingLimitFormScreen layout and actions", () => {
  it("keeps create vs edit titles and back behavior", () => {
    expect(formSrc).toMatch(/Add spending limit/);
    expect(formSrc).toMatch(/Edit spending limit/);
    expect(formSrc).toMatch(/onBack=\{\(\) => router\.back\(\)\}/);
  });

  it("orders fields Category, amount, Period, Spending type, Alert me at, Notes, save, then delete", () => {
    const category = formSrc.indexOf('label="Category"');
    const amount = formSrc.indexOf('label="Limit amount"');
    const period = formSrc.indexOf('label="Period"');
    const type = formSrc.indexOf('label="Spending type"');
    const alert = formSrc.indexOf('label="Alert me at"');
    const notes = formSrc.indexOf('label="Notes"');
    const create = formSrc.indexOf('Create limit');
    const save = formSrc.indexOf("Save changes");
    const danger = formSrc.indexOf("Danger zone");
    const del = formSrc.indexOf('label="Delete limit"');
    expect(category).toBeGreaterThan(-1);
    expect(amount).toBeGreaterThan(category);
    expect(period).toBeGreaterThan(amount);
    expect(type).toBeGreaterThan(period);
    expect(alert).toBeGreaterThan(type);
    expect(notes).toBeGreaterThan(alert);
    expect(create).toBeGreaterThan(notes);
    expect(save).toBeGreaterThan(notes);
    expect(danger).toBeGreaterThan(save);
    expect(del).toBeGreaterThan(danger);
  });

  it("keeps period and spending-type chip controls", () => {
    expect(formSrc).toMatch(/SPENDING_LIMIT_PERIODS/);
    expect(formSrc).toMatch(/SPENDING_TYPE_OPTIONS/);
    expect(formHelpersSrc).toMatch(/Weekly/);
    expect(formHelpersSrc).toMatch(/Monthly/);
    expect(formHelpersSrc).toMatch(/Quarterly/);
    expect(formHelpersSrc).toMatch(/Yearly/);
    expect(formHelpersSrc).toMatch(/Variable/);
    expect(formHelpersSrc).toMatch(/Fixed \/ scheduled/);
  });

  it("preserves warning threshold field and omits a client default of 80", () => {
    expect(formSrc).toMatch(/warning_threshold_percent/);
    expect(formSrc).toMatch(/Leave blank for server default/);
    expect(formSrc).toMatch(/Show a warning when spending reaches this percentage of the limit\./);
    expect(formSrc).not.toMatch(/useState\("80"\)/);
    expect(formSrc).not.toMatch(/\|\| "80"/);
    expect(formSrc).toMatch(/warningThreshold\.trim\(\)/);
  });

  it("validates amount inline and uses a money-friendly keyboard", () => {
    expect(formSrc).toMatch(/validateSpendingLimitAmount/);
    expect(formSrc).toMatch(/fieldErrors\.amount/);
    expect(formSrc).toMatch(/keyboardType="decimal-pad"/);
    expect(formSrc).toMatch(/prefix="\$"/);
  });

  it("creates, edits, and confirms delete", () => {
    expect(formSrc).toMatch(/createSpendingTarget/);
    expect(formSrc).toMatch(/updateSpendingTarget/);
    expect(formSrc).toMatch(/deleteSpendingTarget/);
    expect(formSrc).toMatch(/ConfirmDialog/);
    expect(formSrc).toMatch(/Delete spending limit\?/);
    expect(formSrc).toMatch(/isEdit \?/);
  });
});

describe("Spending Limits list remains unchanged", () => {
  it("keeps FlatList rows with status, spent/remaining, progress, and edit-on-tap", () => {
    expect(listSrc).toMatch(/FlatList/);
    expect(listSrc).toMatch(/BudgetCategoryRow/);
    expect(listSrc).toMatch(/Add spending limit/);
    expect(listSrc).toMatch(/No spending limits/);
    expect(rowSrc).toMatch(/SPENDING_TARGET_STATUS_LABELS/);
    expect(rowSrc).toMatch(/metrics\.spent_so_far/);
    expect(rowSrc).toMatch(/metrics\.remaining_to_target/);
    expect(rowSrc).toMatch(/metrics\.target_amount/);
    expect(rowSrc).toMatch(/metrics\.scheduled_in_period/);
    expect(listSrc).toMatch(/spending-limits\/edit/);
  });

  it("does not change financial display math", () => {
    expect(displaySrc).toMatch(/metrics\.percent_used/);
    expect(displaySrc).toMatch(/metrics\.remaining_to_target/);
    expect(displaySrc).not.toMatch(/spent_so_far \+ scheduled/);
    expect(formSrc).not.toMatch(/spent_so_far/);
    expect(formSrc).not.toMatch(/remaining_to_target/);
    expect(formSrc).not.toMatch(/percent_used/);
  });
});

describe("web Spending Limits form is unchanged by this mobile UX task", () => {
  it("still uses the web modal select, not the mobile picker", () => {
    expect(webFormSrc).toMatch(/<select/);
    expect(webFormSrc).toMatch(/Warning threshold \(%\)/);
    expect(webFormSrc).not.toMatch(/SelectField/);
    expect(webFormSrc).not.toMatch(/OptionsPickerSheet/);
  });
});
