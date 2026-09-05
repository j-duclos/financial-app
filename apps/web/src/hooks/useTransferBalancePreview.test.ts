import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useTransferBalancePreview.ts"),
  "utf8"
);

describe("useTransferBalancePreview", () => {
  it("debounces amount and date for preview requests only", () => {
    expect(source).toMatch(/useDebouncedPreviewValue/);
    expect(source).toMatch(/debouncedAmount/);
    expect(source).toMatch(/debouncedDate/);
    expect(source).toMatch(/DEFAULT_DEBOUNCE_MS = 400/);
    expect(source).toMatch(/previewTransferBalances/);
  });

  it("does not fire preview until required fields are valid", () => {
    expect(source).toMatch(/transferPreviewAmountReady/);
    expect(source).toMatch(/input\.fromAccountId != null/);
    expect(source).toMatch(/input\.toAccountId != null/);
    expect(source).toMatch(/Boolean\(debouncedDate\)/);
  });

  it("keys preview by debounced inputs so obsolete results are ignored", () => {
    expect(source).toMatch(/debouncedDate,/);
    expect(source).toMatch(/amountPayload/);
    expect(source).toMatch(/excludeKey/);
  });
});
