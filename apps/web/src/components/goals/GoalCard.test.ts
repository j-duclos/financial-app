import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "GoalCard.tsx"),
  "utf8"
);

describe("GoalCard", () => {
  it("shows forecast metrics on the card instead of a Quick forecast action", () => {
    expect(source).toMatch(/goalCardMetrics/);
    expect(source).toMatch(/goalCardGapValue/);
    expect(source).toMatch(/goalFundedProgressLine/);
    expect(source).toMatch(/Recommendation:/);
    expect(source).toMatch(/Gap:/);
    expect(source).toMatch(/Try in What-If/);
    expect(source).toMatch(/Details/);
    expect(source).not.toMatch(/Quick forecast/);
    expect(source).not.toMatch(/onForecast/);
    expect(source).not.toMatch(/pace_warnings/);
  });
});
