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
    expect(transactions).toMatch(/transferPreviewAccountIds/);
    expect(transactions).toMatch(/projectedPreviewViewState/);
    expect(transactions).not.toMatch(/destinationCardOwedAmount/);
    expect(transactions).not.toMatch(/getAccount\(inlinePayToCardAccountId/);
    expect(transactions).not.toMatch(/isOutflow \? accountId : inlineTransferToId/);
  });

  it("edit transfer still uses backend preview with exclusions", () => {
    expect(transactions).toMatch(/editTransferPreview = useTransferBalancePreview/);
    expect(transactions).toMatch(/excludeTransactionIds: \[\.\.\.editExcludeTxnIds\]/);
    expect(transactions).toMatch(/editTransferPreview\.data\?\.destination_balance_before/);
    expect(transactions).not.toMatch(/editBankTimelineForHint/);
    expect(transactions).not.toMatch(/editCardTimelineForHint/);
  });

  it("shows calculating/error for dated previews instead of a current-balance fallback", () => {
    expect(inlineAddRow).toMatch(/Calculating projected balance/);
    expect(inlineAddRow).toMatch(/Retry/);
    expect(inlineAddRow).not.toMatch(/inlineCardTimelineLoading/);
    expect(inlineAddRow).not.toMatch(/inlineBankDestTimelineLoading/);
    expect(transactions).toMatch(/Calculating projected balance/);
    expect(transactions).toMatch(/editTransferPreview\.refetch/);
  });
});
