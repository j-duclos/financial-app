import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCOUNT_DETAIL_PREVIEW_LIMIT, accountQueryKeys } from "./queryKeys";
import { transactionsForAccountPath } from "@/features/payment-planner/navigation";

const dir = dirname(fileURLToPath(import.meta.url));
const accountsSource = readFileSync(join(dir, "AccountsScreen.tsx"), "utf8");
const accountDetailSource = readFileSync(join(dir, "AccountDetailScreen.tsx"), "utf8");
const accountsList = readFileSync(join(dir, "useAccountsList.ts"), "utf8");
const accountRow = readFileSync(join(dir, "AccountRow.tsx"), "utf8");

describe("Accounts screen navigation", () => {
  it("does not show Back on Accounts tab root (bottom nav is the way out)", () => {
    expect(accountsSource).toMatch(/<AppHeader/);
    expect(accountsSource).toMatch(/title="Accounts"/);
    expect(accountsSource).not.toMatch(/showBack/);
    expect(accountsSource).not.toMatch(/onBack=/);
    expect(accountsSource).toMatch(/accessibilityLabel="Add account"/);
  });

  it("clears attention filter on the Accounts tab (not a stack /accounts push)", () => {
    expect(accountsSource).toMatch(/\/\(app\)\/\(tabs\)\/accounts/);
    expect(accountsSource).not.toMatch(/replace\("\/accounts"\)/);
  });

  it("routes every account row tap to account detail (no separate View button)", () => {
    expect(accountsSource).toMatch(/router\.push\(`\/account\/\$\{account\.id\}`\)/);
    expect(accountRow).not.toMatch(/label=["']View/);
    expect(accountRow).toMatch(/onPress/);
  });
});

describe("Account detail → View ledger", () => {
  it("opens Transactions with the selected account id and remembers selection", () => {
    expect(accountDetailSource).toMatch(/transactionsForAccountPath/);
    expect(accountDetailSource).toMatch(/rememberTransactionAccountSelection\(account\.id\)/);
    expect(accountDetailSource).toMatch(/label="View ledger"/);
    expect(accountDetailSource).not.toMatch(/View transactions/);

    expect(transactionsForAccountPath(7, "360 Checking")).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: expect.objectContaining({ account: "7", accountName: "360 Checking" }),
    });
    expect(transactionsForAccountPath(1, "Main")).toEqual({
      pathname: "/(app)/(tabs)/transactions",
      params: expect.objectContaining({ account: "1", accountName: "Main" }),
    });
  });

  it("keeps stack Back on Account Detail", () => {
    expect(accountDetailSource).toMatch(/onBack=\{\(\) => router\.back\(\)\}/);
  });
});

describe("Accounts request structure", () => {
  it("uses shared list keys (not incompatible per-screen account keys for the same data)", () => {
    expect(accountQueryKeys.mainList()).toEqual(["accounts", "main", "mobile"]);
    expect(accountQueryKeys.enrichedList(30)).toEqual([
      "accounts",
      "enriched",
      { forecastDays: 30, scope: "mobile" },
    ]);
    expect(accountsList).toMatch(/accountQueryKeys\.mainList/);
    expect(accountsList).toMatch(/accountQueryKeys\.enrichedList/);
    expect(accountDetailSource).toMatch(/accountQueryKeys\.enrichedList/);
    expect(accountDetailSource).toMatch(/accountQueryKeys\.balanceDetail/);
  });

  it("does not issue per-account forecast endpoints from the list hook", () => {
    expect(accountsList).toMatch(/listAccounts/);
    expect(accountsList).not.toMatch(/getAccount\(/);
    expect(accountsList).not.toMatch(/\/available-to-spend/);
    expect(accountsList).not.toMatch(/\/health\//);
  });

  it("bounds Account Detail transaction previews", () => {
    expect(ACCOUNT_DETAIL_PREVIEW_LIMIT).toBe(5);
    expect(accountDetailSource).toMatch(/ACCOUNT_DETAIL_PREVIEW_LIMIT/);
    expect(accountDetailSource).toMatch(/page_size: ACCOUNT_DETAIL_PREVIEW_LIMIT/);
    expect(accountDetailSource).not.toMatch(/page_size: 8/);
  });

  it("seeds detail from list cache and does not wait on forecast for basic shell", () => {
    expect(accountDetailSource).toMatch(/seedAccountFromListCache/);
    expect(accountDetailSource).toMatch(/placeholderData: seeded/);
    expect(accountDetailSource).toMatch(/getAccount\(accountId, true\)/);
    expect(accountDetailSource).not.toMatch(/relationships:\s*true/);
  });

  it("reuses enriched list cache on detail and merges cold forecast into it", () => {
    expect(accountDetailSource).toMatch(/accountQueryKeys\.enrichedList/);
    expect(accountDetailSource).toMatch(/mergeAccountIntoEnrichedListCache/);
    expect(accountDetailSource).toMatch(/enabled: false/);
  });

  it("does not show empty upcoming state while loading", () => {
    expect(accountDetailSource).toMatch(/upcomingTimelineQuery\.isPending/);
    expect(accountDetailSource).toMatch(/No upcoming transactions/);
  });

  it("loads upcoming from canonical timeline rather than listTransactions date range", () => {
    expect(accountDetailSource).toMatch(/defaultLedgerTimelineQueryOptions/);
    expect(accountDetailSource).toMatch(/accountDetailUpcomingPreviewRows/);
    expect(accountDetailSource).not.toMatch(/date_after: today/);
  });
});
