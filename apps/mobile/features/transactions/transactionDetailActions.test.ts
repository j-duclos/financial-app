import { describe, expect, it } from "vitest";
import type { Transaction } from "@budget-app/shared";
import {
  canOpenRecurringRuleDetail,
  getTransactionDetailActions,
  isAlreadyMatchedToImport,
  isEligibleForImportMatch,
  recurringRuleDetailPath,
} from "./transactionDetailActions";

const txn = (partial: Partial<Transaction> & Pick<Transaction, "id">): Transaction =>
  ({
    payee: "Test",
    amount: "-10.00",
    date: "2026-08-28",
    direction: "OUTFLOW",
    cleared: false,
    reconciled: false,
    memo: "",
    tags: [],
    account: { id: 1, name: "Main" } as Transaction["account"],
    category: null,
    ...partial,
  }) as Transaction;

describe("getTransactionDetailActions", () => {
  it("RULE occurrence shows Edit, Match imported transaction, and Skip", () => {
    const actions = getTransactionDetailActions({
      txn: txn({
        id: 1,
        status: "PLANNED",
        source: "RULE",
        rule_id: 42,
      }),
    });
    expect(actions.map((a) => a.kind)).toEqual(["edit", "matchImport", "skip"]);
    expect(actions.find((a) => a.kind === "edit")?.label).toBe("Edit this occurrence");
    expect(actions.find((a) => a.kind === "matchImport")?.label).toBe(
      "Match imported transaction"
    );
    expect(actions.find((a) => a.kind === "skip")?.confirmationTitle).toBe(
      "Skip this occurrence?"
    );
    expect(actions.find((a) => a.kind === "skip")?.confirmationMessage).toMatch(
      /Future occurrences of the recurring rule will continue/
    );
    expect(actions.some((a) => a.kind === "delete")).toBe(false);
  });

  it("one-time planned occurrence shows Match and Skip on detail (ledger opens edit)", () => {
    const actions = getTransactionDetailActions({
      txn: txn({ id: 2, status: "PLANNED", source: "ONE_TIME" }),
    });
    expect(actions.map((a) => a.kind)).toEqual(["matchImport", "skip"]);
    expect(actions.some((a) => a.kind === "delete")).toBe(false);
  });

  it("manual editable transaction omits detail actions (ledger opens edit)", () => {
    const actions = getTransactionDetailActions({
      txn: txn({ id: 3, status: "CLEARED", source: "ACTUAL" }),
    });
    expect(actions).toEqual([]);
  });

  it("bank import blocks Edit and Delete", () => {
    const actions = getTransactionDetailActions({
      txn: txn({ id: 4, status: "CLEARED", source: "PLAID", plaid_transaction_id: "abc" }),
    });
    expect(actions).toEqual([]);
  });

  it("already matched planned row has no match or skip actions", () => {
    const actions = getTransactionDetailActions({
      txn: txn({
        id: 5,
        status: "PLANNED",
        source: "RULE",
        rule_id: 7,
        import_match_status: "matched",
      }),
    });
    expect(actions.map((a) => a.kind)).toEqual(["edit"]);
  });

  it("reconciled row has no actions", () => {
    const actions = getTransactionDetailActions({
      txn: txn({ id: 6, status: "CLEARED", source: "ACTUAL", reconciled: true }),
    });
    expect(actions).toEqual([]);
  });
});

describe("import match eligibility", () => {
  it("planned scheduled rows are eligible until matched", () => {
    const planned = txn({ id: 1, status: "PLANNED", source: "RULE", rule_id: 1 });
    expect(isEligibleForImportMatch(planned)).toBe(true);
    expect(isAlreadyMatchedToImport(planned)).toBe(false);
  });

  it("matched rows are not eligible for another match action", () => {
    const matched = txn({
      id: 2,
      status: "PLANNED",
      source: "RULE",
      rule_id: 1,
      import_match_status: "matched",
    });
    expect(isEligibleForImportMatch(matched)).toBe(false);
    expect(isAlreadyMatchedToImport(matched)).toBe(true);
  });
});

describe("recurring rule navigation", () => {
  it("opens recurring detail when rule_id is present", () => {
    expect(canOpenRecurringRuleDetail(txn({ id: 1, rule_id: 99 }))).toBe(true);
    expect(recurringRuleDetailPath(99)).toBe("/recurring/99");
  });

  it("does not navigate without rule_id", () => {
    expect(canOpenRecurringRuleDetail(txn({ id: 1, rule_id: null }))).toBe(false);
  });
});

describe("TransactionDetailScreen wiring", () => {
  it("uses centralized action resolver and recurring rule navigation", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "TransactionDetailScreen.tsx"), "utf8");
    expect(src).toMatch(/getTransactionDetailActions/);
    expect(src).toMatch(/recurringRuleDetailPath/);
    expect(src).not.toMatch(/canDeleteTransaction/);
  });

  it("match import action does not call skipTransactionOccurrence", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "TransactionDetailScreen.tsx"), "utf8");
    const matchBlock = src.slice(
      src.indexOf('action.kind === "matchImport"'),
      src.indexOf('action.kind === "skip"')
    );
    expect(matchBlock).toMatch(/setMatchSheetOpen\(true\)/);
    expect(matchBlock).not.toMatch(/skipTransactionOccurrence/);
    expect(matchBlock).not.toMatch(/skipMutation\.mutate/);
  });

  it("skip action uses skipTransactionOccurrence only", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "TransactionDetailScreen.tsx"), "utf8");
    expect(src).toMatch(/skipMutation = useMutation\([\s\S]*skipTransactionOccurrence/);
    expect(src).toMatch(/matchTransactionToImport/);
    expect(src).toMatch(/getTransactionImportCandidates/);
    expect(src).not.toMatch(/getTimeline/);
    expect(src).not.toMatch(/scheduledRowHasMatchingImport/);
    expect(src).not.toMatch(/useAccountOptions/);
  });

  it("loads import candidates lazily when the match sheet opens", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "TransactionDetailScreen.tsx"), "utf8");
    expect(src).toMatch(/transactionQueryKeys\.importCandidates/);
    expect(src).toMatch(/enabled:\s*matchSheetOpen && eligibleForImportMatch/);
  });

  it("loads category options only when editing is allowed and the sheet opens", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "TransactionDetailScreen.tsx"), "utf8");
    expect(src).toMatch(/enabled:\s*canChangeCategory && categorySheetOpen/);
  });

  it("saves category immediately on selection", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "TransactionDetailScreen.tsx"), "utf8");
    expect(src).toMatch(/categoryMutation\.mutate/);
    expect(src).not.toMatch(/goBackAfterOptionalCategorySave/);
    expect(src).toMatch(/refreshAfterTransactionEdit\(queryClient,\s*\{\s*categoryOnly:\s*true\s*\}\)/);
  });

  it("invalidates detail cache after match, skip, delete, and category edits", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "TransactionDetailScreen.tsx"), "utf8");
    expect(src).toMatch(/transactionQueryKeys\.detail\(txnId\)/);
    expect(src).not.toMatch(/invalidateFinancialQueries/);
  });
});

describe("TransactionsScreen row navigation wiring", () => {
  it("uses centralized row destination resolver", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "TransactionsScreen.tsx"), "utf8");
    expect(src).toMatch(/getTransactionRowDestination/);
    expect(src).toMatch(/navigateToTransactionRowDestination/);
    expect(src).not.toMatch(/onPressTransaction/);
  });
});

describe("dead matching timeline helpers", () => {
  it("removes obsolete mobile timeline matching adapter", async () => {
    const { accessSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    expect(() =>
      accessSync(join(dir, "transactionMatchingTimeline.ts"))
    ).toThrow();
  });

  it("removes matchingImportTimelineRange from transactionsLedger", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(dir, "../../lib/transactionsLedger.ts"), "utf8");
    expect(src).not.toMatch(/matchingImportTimelineRange/);
  });
});
