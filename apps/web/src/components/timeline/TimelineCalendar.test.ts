import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "TimelineCalendar.tsx"),
  "utf8"
);

describe("TimelineCalendar progressive mount", () => {
  it("keeps a cheap render path for days with no data", () => {
    expect(source).toMatch(/if \(!day\)/);
    expect(source).toMatch(/onMonthVisible/);
    expect(source).not.toMatch(/determineForecastSeverity\(day\)[\s\S]{0,80}if \(!day\)/);
  });
});
