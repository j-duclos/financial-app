import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "GoalActionMenu.tsx"),
  "utf8"
);

describe("GoalActionMenu", () => {
  it("keeps edit and status actions without a Forecast item", () => {
    expect(source).toMatch(/label: "Edit"/);
    expect(source).toMatch(/label: "Duplicate"/);
    expect(source).not.toMatch(/Forecast/);
    expect(source).not.toMatch(/onForecast/);
    expect(source).not.toMatch(/BarChart3/);
  });
});
