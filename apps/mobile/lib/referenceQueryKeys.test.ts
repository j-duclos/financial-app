import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { referenceQueryKeys, ACCOUNT_OPTIONS_STALE_MS, CATEGORY_OPTIONS_STALE_MS } from "./referenceQueryKeys";

const accountHookSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../hooks/useAccountOptions.ts"),
  "utf8"
);

const categoryHookSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../hooks/useCategoryOptions.ts"),
  "utf8"
);

describe("referenceQueryKeys", () => {
  it("uses canonical account-options keys scoped by household", () => {
    expect(referenceQueryKeys.accountOptions(5)).toEqual(["account-options", 5]);
    expect(accountHookSource).toMatch(/referenceQueryKeys\.accountOptions/);
    expect(accountHookSource).not.toMatch(/forecast_summary/);
    expect(accountHookSource).not.toMatch(/health:\s*"true"/);
  });

  it("uses canonical category-options keys scoped by household", () => {
    expect(referenceQueryKeys.categoryOptions(3)).toEqual(["category-options", 3]);
    expect(categoryHookSource).toMatch(/referenceQueryKeys\.categoryOptions/);
  });

  it("gives reference data longer stale times than default queries", () => {
    expect(ACCOUNT_OPTIONS_STALE_MS).toBeGreaterThanOrEqual(60_000);
    expect(CATEGORY_OPTIONS_STALE_MS).toBeGreaterThanOrEqual(60_000);
  });
});
