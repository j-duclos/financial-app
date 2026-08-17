import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "GoalFormModal.tsx"),
  "utf8"
);
const fundingSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "GoalFundingSection.tsx"),
  "utf8"
);

describe("GoalFormModal", () => {
  it("uses Add goal / Edit goal terminology, not bucket", () => {
    expect(source).toMatch(/initial \? "Edit goal" : "Add goal"/);
    expect(source).toMatch(/Create goal/);
    expect(source).toMatch(/Save changes/);
    expect(source).not.toMatch(/Add goal bucket/);
    expect(source).not.toMatch(/Monthly target/);
    expect(source).not.toMatch(/>Options</);
  });

  it("organizes add and edit into Goal, Funding, and Behavior sections", () => {
    expect(source).toMatch(/title="Goal"/);
    expect(source).toMatch(/title="Funding"/);
    expect(source).toMatch(/title="Behavior"/);
    expect(source).toMatch(/Goal name/);
    expect(source).toMatch(/Goal type/);
    expect(source).toMatch(/Target amount/);
    expect(source).toMatch(/Target date \(optional\)/);
    expect(source).toMatch(/Description \(optional\)/);
    expect(source).toMatch(/Linked account/);
    expect(source).toMatch(/Planned monthly contribution/);
    expect(source).toMatch(/Priority/);
    expect(source).toMatch(/Reduce safe-to-spend on linked account/);
    expect(source).toMatch(/Include in forecast/);
    expect(source).toMatch(/validateGoalForm/);
  });

  it("keeps existing types, defaults, and create/edit actions", () => {
    expect(source).toMatch(/GOAL_TYPE_OPTIONS/);
    expect(source).toMatch(/auto_fund_enabled: false/);
    expect(source).toMatch(/include_in_safe_to_spend: true/);
    expect(source).toMatch(/forecast_enabled: true/);
    expect(source).toMatch(/Cancel/);
    expect(source).toMatch(/Create goal/);
    expect(source).toMatch(/Save changes/);
    expect(source).toMatch(/does not move money by itself/);
    expect(source).toMatch(/grid-cols-1 sm:grid-cols-2/);
  });
});

describe("GoalFundingSection", () => {
  it("keeps paycheck auto-funding collapsed until enabled", () => {
    expect(fundingSource).toMatch(/Paycheck auto-funding/);
    expect(fundingSource).toMatch(/Automatically contribute to this goal each payday/);
    expect(fundingSource).toMatch(/Auto-transfer on payday/);
    expect(fundingSource).toMatch(/funding\.enabled &&/);
    expect(fundingSource).toMatch(/Estimated contribution/);
    expect(fundingSource).toMatch(/does not move money|separate from the/);
  });
});
