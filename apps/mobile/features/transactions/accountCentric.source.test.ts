import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transactionListQueryParams } from "@/features/transactions/queryKeys";

const dir = dirname(fileURLToPath(import.meta.url));
const transactionsScreen = readFileSync(join(dir, "TransactionsScreen.tsx"), "utf8");
const transactionsData = readFileSync(join(dir, "useTransactionsData.ts"), "utf8");
const filtersSheet = readFileSync(join(dir, "TransactionFiltersSheet.tsx"), "utf8");
const rowCard = readFileSync(join(dir, "TransactionRowCard.tsx"), "utf8");
const header = readFileSync(join(dir, "AccountLedgerHeader.tsx"), "utf8");
const ledgerDisplay = readFileSync(join(dir, "ledgerHeaderDisplay.ts"), "utf8");
const buildList = readFileSync(join(dir, "buildTransactionList.ts"), "utf8");
const formScreen = readFileSync(join(dir, "TransactionFormScreen.tsx"), "utf8");
const navigationSource = readFileSync(join(dir, "../dashboard/navigation.ts"), "utf8");
const accountDetailSource = readFileSync(join(dir, "../accounts/AccountDetailScreen.tsx"), "utf8");

describe("account-centric transactions screen", () => {
  it("shows compact account selector header", () => {
    expect(transactionsScreen).toMatch(/AccountLedgerHeader/);
    expect(transactionsScreen).toMatch(/AccountSelectorSheet/);
    expect(header).toMatch(/formatLedgerAccountIdentity/);
    expect(header).toMatch(/formatLedgerHeaderBalanceLine/);
    expect(header).not.toMatch(/projected_balance_30_days/);
  });

  it("never labels forecast values as Current balance", () => {
    expect(ledgerDisplay).toMatch(/NEVER uses projected/);
    expect(ledgerDisplay).toMatch(/resolveAccountCurrentBalance/);
    expect(header).toMatch(/forecastBalance/);
    expect(header).toMatch(/balance-only/);
  });

  it("removes the permanent search field from the primary ledger", () => {
    expect(transactionsScreen).not.toMatch(/placeholder="Payee or memo"/);
    expect(transactionsScreen).not.toMatch(/label="Search"/);
    expect(transactionsScreen).toMatch(/name="search"/);
    expect(transactionsScreen).toMatch(/TransactionSearchSheet/);
    expect(filtersSheet).not.toMatch(/label="Search"/);
  });

  it("builds Recent, Pending, Upcoming sections", () => {
    expect(buildList).toMatch(/"Recent"/);
    expect(buildList).toMatch(/"Pending"/);
    expect(buildList).toMatch(/"Upcoming"/);
    expect(buildList).toMatch(/isPendingExpected/);
  });

  it("loads recent history independently of timeline forecast", () => {
    expect(transactionsData).toMatch(/useInfiniteQuery/);
    expect(transactionsData).toMatch(/getTimeline/);
    expect(transactionsData).toMatch(/partitionTimelineForLedger/);
    expect(transactionsData).toMatch(/headerForecastBalance/);
  });

  it("resolves initial account from route, session, and profile default", () => {
    expect(transactionsScreen).toMatch(/resolveInitialTransactionAccount/);
    expect(transactionsScreen).toMatch(/parseRouteAccountId/);
    expect(transactionsScreen).toMatch(/profile\?\.default_account/);
  });

  it("always passes selected account to create transaction", () => {
    expect(transactionsScreen).toMatch(/\/transaction\/new\?account=\$\{filters\.accountId\}/);
  });

  it("uses independent list cache keys per account", () => {
    expect(transactionsScreen).toMatch(/listMountKey/);
    expect(transactionsScreen).toMatch(/filters\.accountId/);
    expect(transactionsData).toMatch(/filters\.accountId != null/);
    expect(transactionsData).toMatch(/account: filters\.accountId/);
  });

  it("does not fetch a global mixed ledger by default", () => {
    const params = transactionListQueryParams({
      accountId: 1,
      dateAfter: "2026-01-01",
      dateBefore: "2026-08-31",
      showReconciled: false,
      historyStart: "2026-06-01",
    });
    expect(params.account).toBe(1);
  });

  it("removes account selection from filter sheet", () => {
    expect(filtersSheet).not.toMatch(/All accounts/);
    expect(filtersSheet).toMatch(/clearTransactionFiltersPreservingAccount/);
  });

  it("does not repeat account name on each transaction row", () => {
    expect(rowCard).not.toMatch(/showAccount/);
    expect(rowCard).not.toMatch(/accountName/);
  });

  it("colors transfer outflows red like other expenses, not neutral black", () => {
    expect(rowCard).toMatch(/tone=\{direction === "INFLOW" \? "positive" : "negative"\}/);
    expect(rowCard).not.toMatch(/isTransfer \? "neutral"/);
  });

  it("Recent Last-N-days respects show reconciled toggle", () => {
    expect(transactionsData).toMatch(/include_reconciled_after: historyStart/);
    expect(transactionsData).toMatch(/show_reconciled: true/);
    expect(transactionsData).toMatch(/reconciled: false/);
    expect(buildList).toMatch(/showReconciled \|\| !txn\.reconciled/);
  });

  it("search and filter icons open different sheets", () => {
    expect(transactionsScreen).toMatch(/TransactionSearchSheet/);
    expect(transactionsScreen).toMatch(/TransactionFiltersSheet/);
    expect(transactionsScreen).toMatch(/setSearchOpen\(true\)/);
    expect(transactionsScreen).toMatch(/setFiltersOpen\(true\)/);
  });

  it("filter sheet omits cleared status chips", () => {
    expect(filtersSheet).not.toMatch(/Cleared/);
  });

  it("add transaction uses searchable pickers instead of chip walls", () => {
    expect(formScreen).toMatch(/SelectField/);
    expect(formScreen).toMatch(/OptionsPickerSheet/);
    expect(formScreen).toMatch(/DatePickerField/);
    expect(formScreen).toMatch(/TransferSourceBalancePreview/);
    expect(formScreen).not.toMatch(/showsHorizontalScrollIndicator/);
  });
});

describe("account-centric navigation entry points", () => {
  it("passes account id from dashboard attention to transactions", () => {
    expect(navigationSource).toMatch(
      /transactionsForAccountPath\(item\.account_id, item\.account_name\)/
    );
  });

  it("passes account id from account details view ledger", () => {
    expect(accountDetailSource).toMatch(/transactionsForAccountPath/);
    expect(accountDetailSource).toMatch(/rememberTransactionAccountSelection\(account\.id\)/);
    expect(accountDetailSource).toMatch(/label="View ledger"/);
  });
});
