import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const transactionsScreen = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "TransactionsScreen.tsx"),
  "utf8"
);

const transactionsData = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useTransactionsData.ts"),
  "utf8"
);

describe("Transactions request orchestration", () => {
  it("uses default household instead of deriving from account list", () => {
    expect(transactionsScreen).toMatch(/useDefaultHouseholdId/);
    expect(transactionsScreen).not.toMatch(/accounts\[0\]\?\.household/);
    expect(transactionsScreen).toMatch(/useAccountOptions/);
    expect(transactionsScreen).not.toMatch(/useCategoryOptions/);
  });

  it("does not block account picker loading on transaction list fetch", () => {
    expect(transactionsScreen).not.toMatch(/accountsQuery\.isLoading/);
    expect(transactionsScreen).toMatch(/useAccountOptions/);
  });

  it("loads recent history without waiting on timeline forecast readiness", () => {
    expect(transactionsData).toMatch(/useInfiniteQuery/);
    expect(transactionsData).toMatch(/getTimeline/);
    expect(transactionsData).not.toMatch(/getReconcileSetup/);
    expect(transactionsData).toMatch(/timelineEnabled/);
    expect(transactionsData).toMatch(/needsTimelineProjection/);
    expect(transactionsData).toMatch(/enabled: filters\.accountId != null/);
    expect(transactionsData).toMatch(/TRANSACTIONS_LEDGER_ORDERING/);
    expect(transactionsData).toMatch(/include_running_balance/);
  });

  it("uses memoized list item and flat list tuning props", () => {
    expect(transactionsScreen).toMatch(/TransactionListItem/);
    expect(transactionsScreen).toMatch(/FINANCIAL_LIST_PROPS/);
    expect(transactionsData).toMatch(/filtersForList/);
  });

  it("anchors the ledger near Pending on open", () => {
    expect(transactionsScreen).toMatch(/ledgerAnchorScrollIndex/);
    expect(transactionsScreen).toMatch(/initialScrollIndex/);
    expect(transactionsScreen).toMatch(/getItemLayout/);
  });
});
