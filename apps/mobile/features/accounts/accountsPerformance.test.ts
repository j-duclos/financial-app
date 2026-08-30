import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accountsTimingSnapshot,
  markAccountsTiming,
  resetAccountsTimingForTests,
} from "./accountsTiming";

const dir = dirname(fileURLToPath(import.meta.url));
const accountsList = readFileSync(join(dir, "useAccountsList.ts"), "utf8");
const accountsScreen = readFileSync(join(dir, "AccountsScreen.tsx"), "utf8");
const detailSource = readFileSync(join(dir, "AccountDetailScreen.tsx"), "utf8");

describe("Accounts request orchestration", () => {
  it("gates enrichment behind main list success unless enrich cache is already fresh", () => {
    expect(accountsList).toMatch(/accountsListEnrichmentEnabled/);
    expect(accountsList).toMatch(/mainListSuccess: mainQuery\.isSuccess/);
    expect(accountsList).toMatch(/enrichedListUpdatedAt/);
    expect(accountsList).not.toMatch(/enabled: forecastReady,/);
  });

  it("uses two-stage merge without blocking initial render on enrichment", () => {
    expect(accountsList).toMatch(/mergeEnrichedAccounts/);
    expect(accountsList).toMatch(/isEnriching/);
    expect(accountsList).toMatch(/placeholderData: keepPreviousData/);
    expect(accountsList).toMatch(/enrichQuery\.isSuccess \? enrichQuery\.data/);
  });

  it("awaits main then enrich on explicit refetch", () => {
    expect(accountsList).toMatch(/const mainResult = await mainQuery\.refetch\(\)/);
    expect(accountsList).toMatch(/mainResult\.isSuccess/);
  });

  it("reuses enriched list cache on Account Detail and merges single-account forecast into it", () => {
    expect(detailSource).toMatch(/accountQueryKeys\.enrichedList\(forecastDays\)/);
    expect(detailSource).toMatch(/mergeAccountIntoEnrichedListCache/);
    expect(detailSource).toMatch(/forecast_summary: true/);
    expect(detailSource).not.toMatch(/relationships:\s*true/);
    expect(detailSource).not.toMatch(/\["account", accountId, "detail"/);
  });
});

describe("Accounts pull-to-refresh", () => {
  it("uses explicit pullRefreshing state on the list (not passive isEnriching)", () => {
    expect(accountsScreen).toMatch(/pullRefreshing/);
    expect(accountsScreen).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(accountsScreen).not.toMatch(/refreshing=\{isEnriching\}/);
  });

  it("uses explicit pullRefreshing state on Account Detail", () => {
    expect(detailSource).toMatch(/pullRefreshing/);
    expect(detailSource).toMatch(/refreshing=\{pullRefreshing\}/);
    expect(detailSource).not.toMatch(/balanceQuery\.isFetching \|\| forecastQuery\.isFetching/);
  });
});

describe("accounts timing instrumentation", () => {
  it("records first-content marks once in development", () => {
    resetAccountsTimingForTests();
    markAccountsTiming("accounts-mounted", "list");
    markAccountsTiming("basic-account-data-visible", "list");
    markAccountsTiming("accounts-mounted", "list");
    const snap = accountsTimingSnapshot();
    expect(snap["accounts-mounted"]).toBeTypeOf("number");
    expect(snap["basic-account-data-visible"]).toBeTypeOf("number");
  });
});
