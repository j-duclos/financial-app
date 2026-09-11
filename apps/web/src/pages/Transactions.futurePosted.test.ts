import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Transactions.tsx"),
  "utf8"
);
const refresh = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../lib/financialQueryRefresh.ts"),
  "utf8"
);
const ledgerUtils = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../components/transactions/transactionsLedgerUtils.ts"
  ),
  "utf8"
);

describe("Transactions canonical future ledger", () => {
  it("does not query or merge future-posted listTransactions rows", () => {
    expect(source).not.toMatch(/\["transactions",\s*"future-posted"/);
    expect(source).not.toMatch(/futurePostedTransactions/);
    expect(source).not.toMatch(/collectPaginatedResults/);
    expect(ledgerUtils).not.toMatch(/futurePostedTransactions/);
    expect(ledgerUtils).not.toMatch(/shouldMergeFuturePostedTransaction/);
    expect(refresh).not.toMatch(/\["transactions", "future-posted"\]/);
  });

  it("refreshes after create, update, move, and delete via a single invalidation", () => {
    expect(source).toMatch(/createMu = useMutation/);
    expect(source).toMatch(/createTransferMu = useMutation/);
    expect(source).toMatch(/deleteMu = useMutation/);
    expect(source).toMatch(/moveDateMu = useMutation/);
    expect(source).toMatch(/afterFinancialEdit/);
    const refreshFn = refresh.slice(refresh.indexOf("export function refreshAfterTransactionEdit"));
    expect(refreshFn).not.toMatch(/refetchQueries/);
  });

  it("clears the add form only after a successful save", () => {
    expect(source).toMatch(/const onAddSuccess = \(\) => \{\s*resetInlineRow\(\);/);
    expect(source).toMatch(/const restoreInlineForm = \(\) => setInlineRow\(formSnapshot\)/);
    expect(source).toMatch(/onError: onAddError/);
  });

  it("does not fetch a household-wide timeline for risk warnings", () => {
    expect(source).not.toMatch(/queryKey: \[\s*"timeline",\s*"household"/);
    expect(source).toMatch(/listProjectedFundsAlerts/);
    expect(source).toMatch(/householdRiskWarningsFromProjectedFundsAlerts/);
    expect(source).not.toMatch(/parseFloat\(r\.running_balance\)/);
  });
});
