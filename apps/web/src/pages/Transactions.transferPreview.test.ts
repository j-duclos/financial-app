import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const transactions = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Transactions.tsx"),
  "utf8"
);
const inlineAddRow = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../components/transactions/InlineAddRow.tsx"
  ),
  "utf8"
);

describe("Transactions transfer preview", () => {
  it("inline add uses backend preview instead of local balance arithmetic", () => {
    expect(transactions).toMatch(/inlineTransferPreview = useTransferBalancePreview/);
    expect(transactions).toMatch(
      /inlineTransferPreview\.data\?\.destination_balance_before/
    );
    expect(transactions).toMatch(
      /inlineTransferPreview\.data\?\.destination_balance_after/
    );
    expect(transactions).toMatch(
      /inlineTransferPreview\.data\?\.destination_balance_owed_before/
    );
    expect(transactions).not.toMatch(/inlineBankDestBalanceBefore \+/);
    expect(transactions).not.toMatch(/deltaOnCounterparty/);
    expect(transactions).not.toMatch(/inlineBankTimelineForHint/);
    expect(transactions).not.toMatch(/inlineCardTimelineForHint/);
    expect(transactions).not.toMatch(/assetBalanceAsOfDateFromTimeline/);
    expect(transactions).not.toMatch(/creditOwedAsOfDateFromTimeline/);
  });

  it("edit transfer still uses backend preview with exclusions", () => {
    expect(transactions).toMatch(/editTransferPreview = useTransferBalancePreview/);
    expect(transactions).toMatch(/excludeTransactionIds: \[\.\.\.editExcludeTxnIds\]/);
    expect(transactions).toMatch(/editTransferPreview\.data\?\.destination_balance_before/);
    expect(transactions).not.toMatch(/editBankTimelineForHint/);
    expect(transactions).not.toMatch(/editCardTimelineForHint/);
  });

  it("InlineAddRow shows loading/unavailable from preview hook, not timeline hints", () => {
    expect(inlineAddRow).toMatch(/inlineTransferPreviewLoading/);
    expect(inlineAddRow).not.toMatch(/inlineCardTimelineLoading/);
    expect(inlineAddRow).not.toMatch(/inlineBankDestTimelineLoading/);
  });
});
