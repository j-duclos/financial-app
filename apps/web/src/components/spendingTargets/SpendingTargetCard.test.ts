import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "SpendingTargetCard.tsx"),
  "utf8"
);

describe("SpendingTargetCard", () => {
  it("renders canonical Limit / Spent / Upcoming / Remaining rows", () => {
    expect(source).toMatch(/spendingTargetCardRows/);
    expect(source).toMatch(/h-full/);
    expect(source).not.toMatch(/Scheduled remaining/);
    expect(source).not.toMatch(/showScheduled/);
  });

  it("keeps edit and delete, without a generic Transactions deep link", () => {
    expect(source).toMatch(/Edit limit/);
    expect(source).toMatch(/Delete/);
    expect(source).not.toMatch(/View transactions/);
    expect(source).not.toMatch(/View category activity/);
    expect(source).not.toMatch(/\/transactions\?category=/);
    expect(source).not.toMatch(/react-router-dom/);
  });

  it("uses committed spending for the progress bar", () => {
    expect(source).toMatch(/spendingTargetProgressPercent/);
  });
});
