import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const accountsList = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useAccountsList.ts"),
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
});
