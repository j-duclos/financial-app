import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useMoneyFlowCalendar.ts"),
  "utf8"
);

describe("useMoneyFlowCalendar", () => {
  it("uses stable summary and chunk query keys scoped to filters", () => {
    expect(source).toMatch(/\["calendar-summary"/);
    expect(source).toMatch(/\["calendar-chunk"/);
    expect(source).toMatch(/\["calendar-timeline-upcoming"/);
    expect(source).toMatch(/horizon/);
    expect(source).toMatch(/lookbackMonths/);
    expect(source).toMatch(/accountId/);
    expect(source).toMatch(/scenarioId/);
  });

  it("does not fetch calendar chunks while Timeline view is active", () => {
    expect(source).toMatch(/viewMode === "calendar"/);
    expect(source).toMatch(/viewMode === "timeline"/);
    expect(source).toMatch(/cancelQueries\(\{ queryKey: \["calendar-chunk"\] \}\)/);
    expect(source).toMatch(/cancelQueries\(\{ queryKey: \["calendar-summary"\] \}\)/);
  });
});
