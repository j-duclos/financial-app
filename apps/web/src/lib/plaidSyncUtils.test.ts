import { describe, expect, it } from "vitest";
import { formatPlaidSyncSummary } from "./plaidSyncUtils";

describe("plaidSyncUtils", () => {
  it("formatPlaidSyncSummary joins counts", () => {
    expect(formatPlaidSyncSummary({ added: 3, modified: 1 })).toBe("3 new, 1 updated");
    expect(formatPlaidSyncSummary({})).toBeNull();
  });
});
