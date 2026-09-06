import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatPlaidSyncSummary } from "./plaidSyncUtils";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "plaidSyncUtils.ts"),
  "utf8"
);

describe("plaidSyncUtils", () => {
  it("formatPlaidSyncSummary joins counts", () => {
    expect(formatPlaidSyncSummary({ added: 3, modified: 1 })).toBe("3 new, 1 updated");
    expect(formatPlaidSyncSummary({})).toBeNull();
  });

  it("invalidates DTI and Payment Planner after a Plaid sync", () => {
    expect(source).toMatch(/queryKey: \["dti"\]/);
    expect(source).toMatch(/queryKey: \["debt-plan"\]/);
    expect(source).toMatch(/queryKey: \["accounts"\]/);
  });
});
