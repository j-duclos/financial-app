import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const transactionsScreen = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../transactions/TransactionsScreen.tsx"),
  "utf8"
);

const transactionsData = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../transactions/useTransactionsData.ts"),
  "utf8"
);

const budgetScreen = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../budget/BudgetScreen.tsx"),
  "utf8"
);

const budgetData = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../budget/useBudgetData.ts"),
  "utf8"
);

const calendarScreen = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../calendar/CalendarScreen.tsx"),
  "utf8"
);

const authContext = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../auth/AuthContext.tsx"),
  "utf8"
);

describe("Rendering performance patterns", () => {
  it("transactions list uses memoized row component and flat list tuning", () => {
    expect(transactionsScreen).toMatch(/TransactionListItem/);
    expect(transactionsScreen).toMatch(/FINANCIAL_LIST_PROPS/);
  });

  it("transaction list rows exclude live search from rebuild deps", () => {
    expect(transactionsData).toMatch(/filtersForList/);
    expect(transactionsData).toMatch(/debouncedSearch/);
    expect(transactionsData).not.toMatch(/\[upcomingRows, historyTransactions, balanceMap, filters,/);
  });

  it("budget keeps prior rows visible during period changes", () => {
    expect(budgetData).toMatch(/keepPreviousData/);
    expect(budgetData).toMatch(/rows\.length === 0/);
  });

  it("budget flat list uses stable render callbacks", () => {
    expect(budgetScreen).toMatch(/useCallback/);
    expect(budgetScreen).toMatch(/FINANCIAL_LIST_PROPS/);
  });

  it("calendar keeps month grid visible while refetching cached days", () => {
    expect(calendarScreen).toMatch(/isLoading && days\.length === 0/);
  });

  it("auth profile hydration avoids replacing auth.profile on every fetch", () => {
    expect(authContext).toMatch(/profile: prev\.profile \?\? profile/);
  });
});
