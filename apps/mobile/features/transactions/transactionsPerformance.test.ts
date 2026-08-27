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
    expect(transactionsScreen).toMatch(/useCategoryOptions/);
  });

  it("does not block transaction list on account or category picker loading", () => {
    expect(transactionsScreen).not.toMatch(/accountsQuery\.isLoading/);
    expect(transactionsScreen).toMatch(/accountsLoading/);
    expect(transactionsScreen).toMatch(/categoriesLoading/);
  });

  it("loads history and timeline concurrently when forecast is ready", () => {
    expect(transactionsData).toMatch(/useInfiniteQuery/);
    expect(transactionsData).toMatch(/getTimeline/);
    expect(transactionsData).toMatch(/enabled: forecastReady && wantsTimeline/);
    expect(transactionsData).toMatch(/needsTimelineProjection/);
    expect(transactionsData).not.toMatch(/enabled:.*accounts/);
  });

  it("uses memoized list item and flat list tuning props", () => {
    expect(transactionsScreen).toMatch(/TransactionListItem/);
    expect(transactionsScreen).toMatch(/FINANCIAL_LIST_PROPS/);
    expect(transactionsData).toMatch(/filtersForList/);
  });
});
