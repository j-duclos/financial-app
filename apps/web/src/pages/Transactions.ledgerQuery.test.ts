import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Transactions.tsx"),
  "utf8"
);

describe("Transactions ledger history query", () => {
  it("sends date_after from ledgerPastTransactionStart, not an open-ended unreconciled fetch", () => {
    expect(source).toMatch(/historyDateAfter = pastTransactionsDateAfter/);
    expect(source).toMatch(/date_after: historyDateAfter/);
    expect(source).not.toMatch(/page_size: 2000/);
  });

  it("uses bounded pagination aligned with mobile page size", () => {
    expect(source).toMatch(/useInfiniteQuery/);
    expect(source).toMatch(/WEB_LEDGER_PAGE_SIZE = 500/);
    expect(source).toMatch(/page_size: WEB_LEDGER_PAGE_SIZE/);
    expect(source).toMatch(/getNextPageParam/);
    expect(source).toMatch(/fetchNextPage/);
  });

  it("waits for reconcile setup before hide-reconciled history so checkpoint lower bound is correct", () => {
    expect(source).toMatch(/getReconcileSetup/);
    expect(source).toMatch(/ledgerPastTransactionStart/);
    expect(source).toMatch(/!hideReconciledPast \|\| !reconcileSetupFetching/);
  });

  it("does not auto-fetch every history page on mount", () => {
    expect(source).not.toMatch(/useEffect\(\(\) => \{\s*\n\s*if \(hasNextPage/);
    expect(source).toMatch(/onLoadMoreHistory/);
    expect(source).toMatch(/hasMoreHistory/);
  });

  it("uses lazy load more in PastSection instead of draining pagination", () => {
    const pastSection = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../components/transactions/PastSection.tsx"),
      "utf8"
    );
    expect(pastSection).toMatch(/Load older transactions/);
  });

  it("keeps reconcile setup for ledger opening balance and checkpoint display", () => {
    expect(source).toMatch(/reconcileSetupData\?\.last_reconciled_balance/);
    expect(source).toMatch(/reconcileSetupData\?\.last_reconcile_period_end/);
    expect(source).toMatch(/reconcileSetupData\?\.min_start_date/);
  });

  it("requests canonical running balances in ascending ledger order", () => {
    expect(source).toMatch(/ordering: "date,id"/);
    expect(source).toMatch(/include_running_balance: true/);
  });
});
