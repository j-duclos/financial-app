import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const calendarScreen = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "CalendarScreen.tsx"),
  "utf8"
);

const calendarData = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useCalendarData.ts"),
  "utf8"
);

describe("Calendar request orchestration", () => {
  it("uses default household from profile instead of account list bootstrap", () => {
    expect(calendarScreen).toMatch(/useDefaultHouseholdId/);
    expect(calendarScreen).not.toMatch(/accounts\[0\]\?\.household/);
    expect(calendarScreen).toMatch(/useAccountOptions/);
  });

  it("lazy-loads account options when filters closed and all accounts selected", () => {
    expect(calendarScreen).toMatch(/enabled: filtersOpen \|\| accountId !== ""/);
  });

  it("does not fetch account options unconditionally on mount", () => {
    expect(calendarScreen).not.toMatch(/useAccountOptions\(\{ householdId: defaultHouseholdId \}\)/);
  });

  it("does not block calendar render on account picker loading", () => {
    expect(calendarScreen).not.toMatch(/accountsQuery\.isLoading && !accountsQuery\.data/);
    expect(calendarScreen).toMatch(/accountsLoading/);
  });

  it("uses shared calendar query keys via forecastScope mapping", () => {
    expect(calendarData).toMatch(/forecastScope: filters\.forecastDays/);
    expect(calendarData).toMatch(/calendarQueryKeys\.summary\(queryFilters\)/);
  });

  it("starts calendar summary concurrently with chunk data", () => {
    expect(calendarData).toMatch(/enabled,/);
    expect(calendarData).not.toMatch(/visibleChunkQuery\.isSuccess/);
  });

  it("does not prefetch adjacent months until canonical reuse is cheap", () => {
    expect(calendarData).not.toMatch(/prefetchMonth/);
    expect(calendarData).not.toMatch(/prefetchAdjacent/);
  });
});
