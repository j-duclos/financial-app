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

describe("Transactions future posted query", () => {
  it("keeps the future-posted fallback and paginates it", () => {
    expect(source).toMatch(/\["transactions",\s*"future-posted"/);
    expect(source).toMatch(/collectPaginatedResults/);
    expect(source).toMatch(/futurePostedTransactions/);
    expect(ledgerUtils).toMatch(/futurePostedTransactions/);
  });

  it("refreshes future-posted after create, update, move, and delete", () => {
    expect(refresh).toMatch(/\["transactions", "future-posted"\]/);
    expect(source).toMatch(/createMu = useMutation/);
    expect(source).toMatch(/createTransferMu = useMutation/);
    expect(source).toMatch(/deleteMu = useMutation/);
    expect(source).toMatch(/moveDateMu = useMutation/);
    expect(source).toMatch(/afterFinancialEdit/);
  });

  it("clears the add form only after a successful save", () => {
    expect(source).toMatch(/const onAddSuccess = \(\) => \{\s*resetInlineRow\(\);/);
    expect(source).toMatch(/const restoreInlineForm = \(\) => setInlineRow\(formSnapshot\)/);
    expect(source).toMatch(/onError: onAddError/);
  });
});
