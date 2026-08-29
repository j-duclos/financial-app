import { describe, expect, it } from "vitest";
import type { Transaction } from "@budget-app/shared";
import {
  canOpenRecurringRuleDetail,
  getTransactionDetailActions,
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
  it("RULE occurrence shows Edit this occurrence and Skip, not Delete", () => {
    const actions = getTransactionDetailActions({
      txn: txn({
        id: 1,
        status: "PLANNED",
        source: "RULE",
        rule_id: 42,
      }),
    });
    expect(actions.map((a) => a.kind)).toEqual(["edit", "skip"]);
    expect(actions.find((a) => a.kind === "edit")?.label).toBe("Edit this occurrence");
    expect(actions.find((a) => a.kind === "skip")?.confirmationTitle).toBe(
      "Skip this occurrence?"
    );
    expect(actions.find((a) => a.kind === "skip")?.confirmationMessage).toMatch(
      /Future occurrences of the recurring rule will continue/
    );
    expect(actions.some((a) => a.kind === "delete")).toBe(false);
  });

  it("one-time planned occurrence shows Skip on detail (ledger opens edit)", () => {
    const actions = getTransactionDetailActions({
      txn: txn({ id: 2, status: "PLANNED", source: "ONE_TIME" }),
    });
    expect(actions.map((a) => a.kind)).toEqual(["skip"]);
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

  it("planned row with matching import offers Matched Import instead of Skip", () => {
    const actions = getTransactionDetailActions({
      txn: txn({ id: 5, status: "PLANNED", source: "RULE", rule_id: 7 }),
      hasMatchingImport: true,
    });
    expect(actions.map((a) => a.kind)).toEqual(["edit", "matchedImport"]);
  });

  it("reconciled row has no actions", () => {
    const actions = getTransactionDetailActions({
      txn: txn({ id: 6, status: "CLEARED", source: "ACTUAL", reconciled: true }),
    });
    expect(actions).toEqual([]);
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
