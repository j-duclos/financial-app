import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const reportsData = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useReportsData.ts"),
  "utf8"
);

describe("Reports request orchestration", () => {
  it("does not fetch household list for default household discovery", () => {
    expect(reportsData).toMatch(/useDefaultHouseholdId/);
    expect(reportsData).not.toMatch(/listHouseholds/);
    expect(reportsData).not.toMatch(/householdsQuery/);
  });

  it("starts monthly report query when household id is available", () => {
    expect(reportsData).toMatch(/enabled: householdId != null/);
    expect(reportsData).toMatch(/getMonthlyReports/);
  });
});
