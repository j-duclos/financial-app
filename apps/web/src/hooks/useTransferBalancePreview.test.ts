import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useTransferBalancePreview.ts"),
  "utf8"
);

describe("useTransferBalancePreview", () => {
  it("keys preview by live account/card/date/amount/exclusion inputs", () => {
    expect(source).toMatch(/queryKey: \[/);
    expect(source).toMatch(/input\.fromAccountId/);
    expect(source).toMatch(/input\.toAccountId/);
    expect(source).toMatch(/input\.date/);
    expect(source).toMatch(/amountPayload/);
    expect(source).toMatch(/excludeKey/);
  });

  it("does not keep a previous preview while live inputs have not settled", () => {
    expect(source).toMatch(/queryMatchesLiveInputs/);
    expect(source).toMatch(/data: queryMatchesLiveInputs \? query\.data : undefined/);
    expect(source).toMatch(/placeholderData: undefined/);
  });

  it("debounces the request, not the displayed value", () => {
    expect(source).toMatch(/enabled: fieldsReady && queryMatchesLiveInputs/);
    expect(source).toMatch(/DEFAULT_DEBOUNCE_MS = 400/);
    expect(source).toMatch(/previewTransferBalances/);
  });

  it("exposes error and retry instead of falling back to another balance", () => {
    expect(source).toMatch(/isError: queryMatchesLiveInputs && query\.isError/);
    expect(source).toMatch(/refetch: \(\) => \{/);
  });
});
