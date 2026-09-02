import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "SpendingTargetFormModal.tsx"),
  "utf8"
);

describe("SpendingTargetFormModal copy", () => {
  it("labels the type field as Spending type", () => {
    expect(source).toMatch(/>Spending type</);
    expect(source).not.toMatch(/Limit behavior/);
  });

  it("keeps fixed and variable options with concise copy", () => {
    expect(source).toMatch(/Fixed \/ scheduled/);
    expect(source).toMatch(/Known bills and scheduled payments\./);
    expect(source).toMatch(/Variable spending/);
    expect(source).toMatch(/Posted spending plus known upcoming transactions\./);
    expect(source).toMatch(/value="fixed"/);
    expect(source).toMatch(/value="variable"/);
  });

  it("omits warning threshold when blank; backend owns the default", () => {
    expect(source).toMatch(/Warning threshold \(%\)/);
    expect(source).not.toMatch(/setWarningThreshold\("80"\)/);
    expect(source).not.toMatch(/\|\| "80"/);
    expect(source).toMatch(/Leave blank for server default/);
    expect(source).toMatch(/if \(threshold\)/);
    expect(source).toMatch(/body\.warning_threshold_percent = threshold/);
  });

  it("preserves backend suggest-type for new limits", () => {
    expect(source).toMatch(/suggestSpendingTargetType/);
  });
});
