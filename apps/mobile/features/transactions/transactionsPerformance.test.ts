import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));

const transactionsData = readFileSync(join(dir, "useTransactionsData.ts"), "utf8");
const previewSource = readFileSync(join(dir, "TransferSourceBalancePreview.tsx"), "utf8");
const transactionsScreen = readFileSync(join(dir, "TransactionsScreen.tsx"), "utf8");

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

  it("loads recent and timeline concurrently without serializing on history settle", () => {
    expect(transactionsData).toMatch(/useInfiniteQuery/);
    expect(transactionsData).toMatch(/getTimeline/);
    expect(transactionsData).not.toMatch(/getReconcileSetup/);
    expect(transactionsData).toMatch(/timelineEnabled/);
    expect(transactionsData).toMatch(/needsTimelineProjection/);
    expect(transactionsData).not.toMatch(/historySettled/);
    expect(transactionsData).toMatch(
      /forecastReady && wantsTimeline && filters\.accountId != null/
    );
    expect(transactionsData).toMatch(/canonicalHistoryQuery/);
    expect(transactionsData).toMatch(/displayHistoryQuery/);
    expect(transactionsData).toMatch(/listDisplay/);
    expect(transactionsData).toMatch(/needsServerFilteredHistory/);
    expect(transactionsData).toMatch(/historyComplete/);
    expect(transactionsData).toMatch(/currentBalanceFromLedgerData/);
    expect(transactionsData).toMatch(/forecastBalanceFromUpcoming/);
  });

  it("does not auto-drain filtered display history pages", () => {
    expect(transactionsData).not.toMatch(/displayHistoryQuery\.fetchNextPage/);
    expect(transactionsData).not.toMatch(
      /while \(.*hasNextPage.*fetchNextPage/s
    );
  });

  it("settled filtered empty state after first page without draining pagination", () => {
    expect(transactionsData).toMatch(/displayQuerySettled/);
    expect(transactionsData).toMatch(/displayHistoryQuery\.isFetched/);
    expect(transactionsData).not.toMatch(
      /displayQuerySettled[\s\S]*!displayHistoryQuery\.hasNextPage/
    );
  });

  it("header balances use canonical unfiltered history, not display query", () => {
    expect(transactionsData).toMatch(/canonicalHistoryTransactions/);
    expect(transactionsData).toMatch(/headerCurrentFromLedger/);
    expect(transactionsData).toMatch(/headerForecastBalance/);
    expect(transactionsData).toMatch(/forecastBalanceFromUpcoming\(upcoming\)/);
    expect(transactionsData).toMatch(/fetchNextPage: activeHistoryQuery\.fetchNextPage/);
  });

  it("transfer preview uses backend previewTransferBalances", () => {
    expect(previewSource).toMatch(/previewTransferBalances/);
    expect(previewSource).not.toMatch(/balanceBefore - Math\.abs/);
  });

  it("uses memoized list item and flat list tuning props", () => {
    expect(transactionsScreen).toMatch(/TransactionListItem/);
    expect(transactionsScreen).toMatch(/FINANCIAL_LIST_PROPS/);
    expect(transactionsData).toMatch(/filtersForList/);
  });

  it("opens the ordinary ledger at the top without auto-scroll", () => {
    expect(transactionsScreen).toMatch(/ledgerListReady/);
    expect(transactionsScreen).toMatch(/onScrollBeginDrag/);
    expect(transactionsScreen).not.toMatch(/initialScrollIndex/);
    expect(transactionsScreen).not.toMatch(/findDefaultLedgerOpenIndex/);
    expect(transactionsScreen).not.toMatch(/onContentSizeChange/);
  });

  it("paginates filtered history on end reached", () => {
    expect(transactionsScreen).toMatch(/onEndReached/);
    expect(transactionsScreen).toMatch(/fetchNextPage/);
    expect(transactionsScreen).toMatch(/displayQuerySettled/);
  });

  it("paginates unbounded history via Load older instead of draining pages", () => {
    expect(transactionsData).toMatch(/flattenLedgerHistoryPages/);
    expect(transactionsData).toMatch(/newestFirstHistory/);
    expect(transactionsData).toMatch(/TRANSACTIONS_LEDGER_ORDERING_NEWEST_FIRST/);
    expect(transactionsData).not.toMatch(/while \(.*hasNextPage.*fetchNextPage/s);
    expect(transactionsScreen).toMatch(/onPressLoadOlder/);
    expect(transactionsScreen).toMatch(/if \(newestFirstHistory\) return/);
    expect(previewSource).not.toMatch(/page_size: 2000/);
  });

  it("refetches active independent queries concurrently", () => {
    expect(transactionsData).toMatch(/Promise\.all/);
    expect(transactionsData).toMatch(
      /\.\.\.\(needsServerFilteredHistory \? \[displayHistoryQuery\.refetch\(\)\] : \[\]\)/
    );
    expect(transactionsData).toMatch(/\.\.\.\(wantsTimeline \? \[timelineQuery\.refetch\(\)\] : \[\]\)/);
    expect(transactionsData).not.toMatch(
      /if \(needsServerFilteredHistory\) await displayHistoryQuery\.refetch/
    );
    expect(transactionsData).not.toMatch(/if \(wantsTimeline\) await timelineQuery\.refetch/);
  });
});
