import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  accountsTimingSnapshot,
  markAccountsTiming,
  resetAccountsTimingForTests,
} from "./accountsTiming";

const accountsList = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useAccountsList.ts"),
  "utf8"
);
const detailSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "AccountDetailScreen.tsx"),
  "utf8"
);

describe("Accounts request orchestration", () => {
  it("runs enriched accounts concurrently with basic list", () => {
    expect(accountsList).toMatch(/enabled: forecastReady/);
    expect(accountsList).not.toMatch(/enabled: mainQuery\.isSuccess/);
  });

  it("uses two-stage merge without blocking initial render on enrichment", () => {
    expect(accountsList).toMatch(/mergeEnrichedAccounts/);
    expect(accountsList).toMatch(/isEnriching/);
    expect(accountsList).toMatch(/placeholderData: keepPreviousData/);
  });

  it("reuses enriched list cache on Account Detail and merges single-account forecast into it", () => {
    expect(detailSource).toMatch(/accountQueryKeys\.enrichedList\(forecastDays\)/);
    expect(detailSource).toMatch(/mergeAccountIntoEnrichedListCache/);
    expect(detailSource).toMatch(/forecast_summary: true/);
    expect(detailSource).not.toMatch(/relationships:\s*true/);
    expect(detailSource).not.toMatch(/\["account", accountId, "detail"/);
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
