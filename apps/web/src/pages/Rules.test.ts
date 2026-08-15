import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rulesSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "Rules.tsx"), "utf8");

describe("Automation page", () => {
  it("exports Rules component", async () => {
    const mod = await import("./Rules");
    expect(typeof mod.default).toBe("function");
  });

  it("uses Rules & Automation copy", () => {
    expect(rulesSource).toMatch(/AUTOMATION_NAV_LABEL/);
    expect(rulesSource).toMatch(/AUTOMATION_PAGE_INTRO/);
  });

  it("loads rules on visit and defers form-support data until the modal opens", () => {
    expect(rulesSource).toMatch(/queryKey: \["rules"\]/);
    expect(rulesSource).toMatch(/useOperationalAccounts\(\{ enabled: modalOpen \}\)/);
    expect(rulesSource).toMatch(/useCategories\(\{ enabled: modalOpen \}\)/);
    expect(rulesSource).toMatch(/enabled: modalOpen/);
    expect(rulesSource).not.toMatch(/refetchOnMount:\s*"always"/);
  });

  it("computes estimated monthly cash flow from all rules, not the search subset", () => {
    expect(rulesSource).toMatch(/estimatedMonthlyCashFlow\(rules,/);
    expect(rulesSource).not.toMatch(/estimatedMonthlyCashFlow\(filteredRules/);
  });

  it("centralizes recurring-rule mutation invalidation", () => {
    expect(rulesSource).toMatch(/invalidateRecurringRuleDependents/);
  });
});
