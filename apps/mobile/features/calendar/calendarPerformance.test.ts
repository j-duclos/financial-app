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

  it("does not block calendar render on account picker loading", () => {
    expect(calendarScreen).not.toMatch(/accountsQuery\.isLoading && !accountsQuery\.data/);
    expect(calendarScreen).toMatch(/accountsLoading/);
  });

  it("starts calendar summary concurrently with chunk data", () => {
    expect(calendarData).toMatch(/enabled,/);
    expect(calendarData).not.toMatch(/visibleChunkQuery\.isSuccess/);
  });

  it("prefetches adjacent months without waiting for visible chunk success", () => {
    expect(calendarData).not.toMatch(/visibleChunkQuery\.isSuccess[\s\S]{0,120}prefetchMonth/);
  });
});
