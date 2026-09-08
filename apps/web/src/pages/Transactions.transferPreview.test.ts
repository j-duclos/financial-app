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
  it("inline bank dest shows current ledger from ?balance=true, not a dated projection", () => {
    expect(transactions).toMatch(/balance: "true"/);
    expect(transactions).toMatch(/inlineBankDestLedgerPreview/);
    expect(transactions).not.toMatch(
      /inlineBankPreviewView = projectedTransferBalancesViewState/
    );
    expect(transactions).not.toMatch(
      /inlineTransferPreview\.data\?\.destination_balance_after/
    );
    expect(transactions).not.toMatch(/inlineBankDestBalanceBefore \+/);
    expect(transactions).not.toMatch(/deltaOnCounterparty/);
    expect(transactions).not.toMatch(/inlineBankTimelineForHint/);
    expect(transactions).not.toMatch(/assetBalanceAsOfDateFromTimeline/);
    expect(inlineAddRow).toMatch(/Other account/);
    expect(inlineAddRow).not.toMatch(/: "Transfer to"/);
    expect(transactions).toMatch(/Other account/);
  });

  it("inline credit-card payment still uses the dated backend preview", () => {
    expect(transactions).toMatch(/inlineTransferPreview = useTransferBalancePreview/);
    expect(transactions).toMatch(
      /inlineTransferPreview\.data\?\.destination_balance_owed_before/
    );
    expect(transactions).toMatch(/projectedPreviewViewState/);
    expect(transactions).not.toMatch(/destinationCardOwedAmount/);
    expect(transactions).not.toMatch(/getAccount\(inlinePayToCardAccountId/);
    expect(inlineAddRow).toMatch(/Calculating projected balance/);
  });

  it("edit transfer still uses backend preview with exclusions and dest-id matching", () => {
    expect(transactions).toMatch(/editTransferPreview = useTransferBalancePreview/);
    expect(transactions).toMatch(/excludeTransactionIds: \[\.\.\.editExcludeTxnIds\]/);
    expect(transactions).toMatch(/previewBalancesForAccountId/);
    expect(transactions).toMatch(/editTransferPreview\.data\?\.destination_balance_before/);
    expect(transactions).not.toMatch(/editBankTimelineForHint/);
    expect(transactions).not.toMatch(/editCardTimelineForHint/);
    expect(transactions).toMatch(/editTransferPreview\.refetch/);
    expect(transactions).toMatch(
      /const showEditTransferToSelector =\s*Boolean\(editing\) &&\s*editTransferToAccounts\.length > 0 &&/
    );
    expect(transactions).toMatch(/signedAmount = amt/);
    expect(transactions).not.toMatch(/ledgerFlow:/);
    expect(transactions).toMatch(/amount: signedAmountForEditForm\(txn\.amount\)/);
  });
});
