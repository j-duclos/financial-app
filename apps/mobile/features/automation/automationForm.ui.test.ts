/**
 * Create Automation Step 3 category picker — compact searchable select, not a chip cloud.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const formSrc = readFileSync(join(here, "AutomationFormScreen.tsx"), "utf8");
const pickerSrc = readFileSync(join(here, "automationCategoryPicker.ts"), "utf8");
const sheetSrc = readFileSync(join(here, "../../components/forms/OptionsPickerSheet.tsx"), "utf8");

describe("AutomationFormScreen category picker", () => {
  it("does not render a category chip cloud on the conditions step", () => {
    expect(formSrc).not.toContain("categoryChipOptions");
    expect(formSrc).not.toMatch(/label="Category"[\s\S]{0,250}flexWrap:\s*"wrap"/);
    expect(formSrc).not.toMatch(/ChipRow[\s\S]{0,80}label="Category"/);
  });

  it("uses one SelectField that defaults to Any category and opens the shared picker", () => {
    expect(formSrc).toContain("SelectField");
    expect(formSrc).toContain('label="Category"');
    expect(formSrc).toContain("automationCategoryFieldValue");
    expect(formSrc).toContain("ANY_CATEGORY_LABEL");
    expect(pickerSrc).toContain('export const ANY_CATEGORY_LABEL = "Any category"');
    expect(formSrc).toContain("setCategoryPickerOpen(true)");
    expect(formSrc).toContain("OptionsPickerSheet");
    expect(formSrc).toContain("visible={categoryPickerOpen}");
    expect(formSrc).toContain("CHOOSE_CATEGORY_TITLE");
    expect(pickerSrc).toContain('export const CHOOSE_CATEGORY_TITLE = "Choose category."');
    expect(formSrc).toContain('searchPlaceholder="Search categories"');
    expect(formSrc).toContain("tall");
  });

  it("selects one real category, closes the sheet, and can clear back to null", () => {
    expect(formSrc).toContain("serializeAutomationCategoryId(id)");
    expect(formSrc).toContain('selectedId={form.category_id != null ? String(form.category_id) : ""}');
    expect(formSrc).toContain("onClose={() => setCategoryPickerOpen(false)}");
    expect(pickerSrc).toContain("optionId ? Number(optionId) : null");
    expect(formSrc).toContain("category_id: form.category_id");
    expect(formSrc).not.toContain("category_ids");
    expect(formSrc).toContain("useCategoryOptions");
    expect(formSrc).toContain("automationCategoryPickerOptions(categories, categoryPickerType)");
  });

  it("keeps accounts above the category field and Continue in a sticky footer", () => {
    const accounts = formSrc.indexOf('label="From account"');
    const category = formSrc.indexOf('label="Category"');
    const footer = formSrc.indexOf('testID="automation-step-footer"');
    const continueBtn = formSrc.indexOf('label="Continue"');
    expect(accounts).toBeGreaterThan(-1);
    expect(category).toBeGreaterThan(accounts);
    expect(footer).toBeGreaterThan(category);
    expect(continueBtn).toBeGreaterThan(footer);
    expect(formSrc).toContain("KeyboardAvoidingView");
    expect(formSrc).toContain("useSafeAreaInsets");
  });
});

describe("shared OptionsPickerSheet category presentation", () => {
  it("has search, visible cancel, checkmark, and 44pt targets", () => {
    expect(sheetSrc).toContain("accessibilityLabel=\"Cancel\"");
    expect(sheetSrc).toContain('accessibilityRole="radio"');
    expect(sheetSrc).toContain('name="check"');
    expect(sheetSrc).toContain("keyboardAware");
    expect(sheetSrc).toContain("minHeight: theme.touchTarget");
    expect(sheetSrc).toContain("setQuery(\"\")");
  });
});
