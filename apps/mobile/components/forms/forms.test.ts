import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(root, "../..");

function read(rel: string): string {
  return readFileSync(join(mobileRoot, rel), "utf8");
}

describe("shared form components", () => {
  const selectField = read("components/forms/SelectField.tsx");
  const optionsPicker = read("components/forms/OptionsPickerSheet.tsx");
  const datePicker = read("components/forms/DatePickerField.tsx");
  const sheetAction = read("components/forms/SheetActionRow.tsx");

  it("SelectField supports value, placeholder, error, accessibility, and press", () => {
    expect(selectField).toMatch(/label: string/);
    expect(selectField).toMatch(/value: string \| null/);
    expect(selectField).toMatch(/placeholder\?: string/);
    expect(selectField).toMatch(/error\?: string/);
    expect(selectField).toMatch(/accessibilityRole="button"/);
    expect(selectField).toMatch(/accessibilityLabel/);
    expect(selectField).toMatch(/onPress={onPress}/);
    expect(selectField).toMatch(/theme\.colors\.critical/);
    expect(selectField).toMatch(/theme\.touchTarget/);
  });

  it("OptionsPickerSheet supports search, selection, and empty state", () => {
    expect(optionsPicker).toMatch(/searchPlaceholder/);
    expect(optionsPicker).toMatch(/emptyMessage/);
    expect(optionsPicker).toMatch(/selectedId/);
    expect(optionsPicker).toMatch(/onSelect/);
    expect(optionsPicker).toMatch(/TextInput/);
    expect(optionsPicker).toMatch(/filtered\.length === 0/);
  });

  it("DatePickerField preserves native date picker behavior", () => {
    expect(datePicker).toMatch(/DateTimePicker/);
    expect(datePicker).toMatch(/Platform\.OS === "android"/);
    expect(datePicker).toMatch(/formatDateDisplay/);
    expect(datePicker).toMatch(/EndsDateField/);
  });

  it("SheetActionRow supports normal and destructive actions", () => {
    expect(sheetAction).toMatch(/destructive\?: boolean/);
    expect(sheetAction).toMatch(/theme\.colors\.critical/);
    expect(sheetAction).toMatch(/accessibilityRole="button"/);
    expect(sheetAction).toMatch(/minHeight: theme\.touchTarget/);
  });
});

describe("shared form import boundaries", () => {
  const featureSources = [
    "features/recurring/RecurringFormScreen.tsx",
    "features/goals/GoalFormScreen.tsx",
    "features/categories/CategoryFormScreen.tsx",
    "features/what-if/forms/NewRecurringSheet.tsx",
    "features/reconcile/ReconcileScreen.tsx",
    "features/profile/ProfileSettingsScreen.tsx",
    "features/payment-planner/StrategyModePanel.tsx",
  ].map(read);

  it("features import general-purpose forms from components/forms", () => {
    for (const src of featureSources) {
      expect(src).toMatch(/@\/components\/forms/);
      expect(src).not.toMatch(/@\/features\/recurring\/OptionsPickerSheet/);
      expect(src).not.toMatch(/@\/features\/recurring\/DatePickerField/);
    }
  });

  it("recurring no longer owns OptionsPickerSheet or DatePickerField files", () => {
    expect(() => read("features/recurring/OptionsPickerSheet.tsx")).toThrow();
    expect(() => read("features/recurring/DatePickerField.tsx")).toThrow();
  });
});

describe("Goals rules cache consolidation", () => {
  it("GoalFormScreen uses canonical useRules hook", () => {
    const goalForm = read("features/goals/GoalFormScreen.tsx");
    const queryKeys = read("features/goals/queryKeys.ts");
    expect(goalForm).toMatch(/useRules/);
    expect(goalForm).not.toMatch(/formRules/);
    expect(goalForm).not.toMatch(/recurring-rules/);
    expect(queryKeys).not.toMatch(/formRules/);
    expect(queryKeys).not.toMatch(/recurring-rules/);
    expect(read("hooks/useRules.ts")).toMatch(/\["rules"\]/);
  });

  it("goal funding invalidation refreshes canonical rules cache", () => {
    const queryKeys = read("features/goals/queryKeys.ts");
    expect(queryKeys).toMatch(/\["rules"\]/);
    expect(queryKeys).not.toMatch(/recurring-rules/);
  });
});

describe("overflow sheet action row consolidation", () => {
  it("feature sheets use shared SheetActionRow", () => {
    expect(read("features/goals/GoalActionsSheet.tsx")).toMatch(/SheetActionRow/);
    expect(read("features/what-if/components/PlanActionsSheet.tsx")).toMatch(/SheetActionRow/);
    expect(read("features/action-center/RecommendationOverflowSheet.tsx")).toMatch(/SheetActionRow/);
  });
});

describe("DetailRow consolidation", () => {
  it("horizontal detail screens use shared DetailRow", () => {
    expect(read("features/recurring/RecurringDetailScreen.tsx")).toMatch(/DetailRow/);
    expect(read("features/automation/AutomationDetailScreen.tsx")).toMatch(/DetailRow/);
    expect(read("features/reconcile/ReconcileScreen.tsx")).toMatch(/DetailRow/);
  });

  it("transaction detail keeps stacked local DetailRow", () => {
    const txn = read("features/transactions/TransactionDetailScreen.tsx");
    expect(txn).toMatch(/function DetailRow/);
    expect(txn).not.toMatch(/DetailRow,/);
  });
});
