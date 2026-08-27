import { describe, expect, it } from "vitest";
import type { ReconcilePreviewResponse, ReconcileTransactionRow } from "@budget-app/shared";
import {
  checkedIdsKey,
  differenceStatusCopy,
  hasBankBalanceInput,
  normalizeMoneyInput,
  partitionReconcileTransactions,
  sessionStatusLabel,
} from "./reconcileDisplay";

function txn(overrides: Partial<ReconcileTransactionRow> = {}): ReconcileTransactionRow {
  return {
    id: 1,
    date: "2026-08-01",
    payee: "Chewy",
    memo: "",
    amount: "-79.46",
    direction: "OUTFLOW",
    category: "Dog Food",
    source: "MANUAL",
    cleared: false,
    reconciled: false,
    running_balance: "920.54",
    ...overrides,
  };
}

describe("reconcileDisplay", () => {
  it("normalizes money input without inventing totals", () => {
    expect(normalizeMoneyInput("$1,234.567")).toBe("1234.56");
    expect(normalizeMoneyInput("-25.5")).toBe("-25.5");
    expect(hasBankBalanceInput("")).toBe(false);
    expect(hasBankBalanceInput("0")).toBe(true);
  });

  it("partitions checked vs uncleared without mixing accounts", () => {
    const rows = [txn({ id: 1 }), txn({ id: 2, payee: "Rent" }), txn({ id: 3, payee: "Pay" })];
    const { checked, unchecked } = partitionReconcileTransactions(rows, new Set([2]));
    expect(checked.map((t) => t.id)).toEqual([2]);
    expect(unchecked.map((t) => t.id)).toEqual([1, 3]);
  });

  it("builds stable checked-id keys for preview query identity", () => {
    expect(checkedIdsKey([3, 1, 2])).toBe("1,2,3");
    expect(checkedIdsKey(new Set([2, 1]))).toBe("1,2");
  });

  it("uses server can_complete for ready-to-reconcile copy", () => {
    const ready: Pick<ReconcilePreviewResponse, "difference" | "can_complete"> = {
      difference: "0.00",
      can_complete: true,
    };
    const blocked = { difference: "-25.00", can_complete: false };
    expect(differenceStatusCopy(ready).ready).toBe(true);
    expect(differenceStatusCopy(blocked).message).toMatch(/do not match/i);
    expect(differenceStatusCopy(null).ready).toBe(false);
  });

  it("labels session status for history rows", () => {
    expect(sessionStatusLabel({ is_active: true, is_balanced: true })).toBe("Completed");
    expect(sessionStatusLabel({ is_active: false, is_balanced: true })).toBe("Undone");
  });
});
