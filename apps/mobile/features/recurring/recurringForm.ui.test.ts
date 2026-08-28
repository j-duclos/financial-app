/**
 * Recurring form UI contract tests — picker-based form (no account/category chip walls).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const formSrc = readFileSync(join(here, "RecurringFormScreen.tsx"), "utf8");
const listSrc = readFileSync(join(here, "RecurringListScreen.tsx"), "utf8");
const rowSrc = readFileSync(join(here, "RecurringRow.tsx"), "utf8");

describe("RecurringFormScreen structure", () => {
  it("uses account/category pickers instead of chip walls", () => {
    expect(formSrc).toContain("OptionsPickerSheet");
    expect(formSrc).toContain("useAccountOptions");
    expect(formSrc).toContain("useCategoryOptions");
    expect(formSrc).toContain("SelectField");
    expect(formSrc).toContain('label="Category"');
    // Category/Account use SelectField + OptionsPickerSheet, not ChipRow walls
    expect(formSrc).toContain("setCategoryPickerOpen");
    expect(formSrc).toContain('setAccountPicker("from")');
    expect(formSrc).not.toMatch(/accounts\.map\(\(a\) => \(\{ value: String\(a\.id\)/);
    expect(formSrc).not.toMatch(/categories\.map\(\(c\) => \(\{ value: String\(c\.id\)/);
  });

  it("shows type-dependent transfer destination and hides category for transfers", () => {
    expect(formSrc).toContain('form.direction !== "TRANSFER"');
    expect(formSrc).toContain("showTransferDestination");
    expect(formSrc).toContain("Transfer destination is required");
    expect(formSrc).toContain('name === "Bank Transfer"');
  });

  it("shows frequency-dependent scheduling fields only", () => {
    expect(formSrc).toContain('form.frequency === "MONTHLY_DAY"');
    expect(formSrc).toContain('form.frequency === "WEEKLY"');
    expect(formSrc).toContain('form.frequency === "BIWEEKLY"');
    expect(formSrc).toContain('form.frequency === "MONTHLY_NTH_WEEKDAY"');
    expect(formSrc).toContain("DatePickerField");
    expect(formSrc).toContain("EndsDateField");
  });

  it("defaults align with product defaults", () => {
    expect(formSrc).toContain('direction: "EXPENSE"');
    expect(formSrc).toContain('frequency: "MONTHLY_DAY"');
    expect(formSrc).toContain('lifecycleStatus: "running"');
    expect(formSrc).toContain("start_date: todayStr()");
  });
});

describe("Recurring list UI structure", () => {
  it("uses compact rows without direction badge or color bar", () => {
    expect(rowSrc).not.toContain("width: 4");
    expect(rowSrc).not.toContain("directionLabel");
    expect(rowSrc).toContain("CurrencyDisplay");
    expect(rowSrc).toContain("lifecycleBadgeLabel");
    expect(listSrc).not.toContain("getBillsOverview");
    expect(listSrc).toContain('useState<RecurringSortKey>("next")');
  });
});
