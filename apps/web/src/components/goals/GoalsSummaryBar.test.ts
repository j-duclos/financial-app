import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "GoalsSummaryBar.tsx"),
  "utf8"
);

describe("GoalsSummaryBar", () => {
  it("labels the completion tile as Projected completion", () => {
    expect(source).toMatch(/Projected completion/);
    expect(source).not.toMatch(/label="Completion"/);
  });
});
