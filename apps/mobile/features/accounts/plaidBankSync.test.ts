import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatPlaidSyncSummary } from "./plaidBankSync";

const dir = dirname(fileURLToPath(import.meta.url));
const accountsScreen = readFileSync(join(dir, "AccountsScreen.tsx"), "utf8");
const hook = readFileSync(join(dir, "usePlaidBankSync.ts"), "utf8");
const transactionsScreen = readFileSync(join(dir, "../transactions/TransactionsScreen.tsx"), "utf8");

describe("formatPlaidSyncSummary", () => {
  it("describes imported counts", () => {
    expect(formatPlaidSyncSummary({ added: 4, merged: 1, modified: 0, removed: 0 })).toBe(
      "4 new, 1 linked to your manual entries"
    );
  });

  it("explains a failed import with no new rows", () => {
    expect(formatPlaidSyncSummary({ failed_items: 1, synced_items: 0 })).toMatch(/Bank import failed/);
  });
});

describe("mobile Plaid sync entry points", () => {
  it("exposes Sync banks and pull-to-refresh import on Accounts", () => {
    expect(accountsScreen).toMatch(/label="Sync banks"/);
    expect(accountsScreen).toMatch(/syncBanks\(\{ silent: true \}\)/);
    expect(hook).toMatch(/syncAllPlaidItems|runHouseholdPlaidSync/);
    expect(hook).toMatch(/force: true/);
  });

  it("imports on Transactions pull-to-refresh", () => {
    expect(transactionsScreen).toMatch(/onPullRefresh/);
    expect(transactionsScreen).toMatch(/syncBanks\(\{ silent: true \}\)/);
    expect(transactionsScreen).toMatch(/refreshing=\{pullRefreshing\}/);
  });
});
