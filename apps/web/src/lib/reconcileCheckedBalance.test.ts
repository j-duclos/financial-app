import { describe, expect, it } from "vitest";
import type { ReconcileTransactionRow } from "@budget-app/shared";
import { reconcileBalanceAfterChecks } from "./reconcileCheckedBalance";

function row(
  partial: Pick<ReconcileTransactionRow, "id" | "date" | "amount"> &
    Partial<ReconcileTransactionRow>
): ReconcileTransactionRow {
  return {
    payee: "Test",
    memo: "",
    direction: "OUTFLOW",
    category: null,
    source: "MANUAL",
    cleared: false,
    reconciled: false,
    running_balance: null,
    ...partial,
  };
}

describe("reconcileBalanceAfterChecks", () => {
  const opening = 1236.52;
  const txns = [
    row({ id: 1, date: "2026-05-14", amount: "1835.52", running_balance: "3072.04" }),
    row({ id: 2, date: "2026-05-14", amount: "-21.21", running_balance: "3050.83" }),
    row({ id: 3, date: "2026-06-10", amount: "-50.00", running_balance: "1835.85" }),
  ];

  it("returns opening when nothing is checked", () => {
    expect(reconcileBalanceAfterChecks(txns, new Set(), opening)).toBe(opening);
  });

  it("uses opening plus checked amounts only", () => {
    expect(reconcileBalanceAfterChecks(txns, new Set([1, 2]), opening)).toBeCloseTo(
      opening + 1835.52 - 21.21,
      2
    );
    expect(reconcileBalanceAfterChecks(txns, new Set([1, 2, 3]), opening)).toBeCloseTo(
      opening + 1835.52 - 21.21 - 50,
      2
    );
  });

  it("ignores unchecked siblings even when running balances include them", () => {
    const partial = [
      row({ id: 1, date: "2026-05-14", amount: "50.00", running_balance: "1050.00" }),
      row({ id: 2, date: "2026-05-14", amount: "-30.00", running_balance: "1020.00" }),
      row({ id: 3, date: "2026-05-14", amount: "20.00", running_balance: "1040.00" }),
    ];
    expect(reconcileBalanceAfterChecks(partial, new Set([1, 3]), 1000)).toBe(1070);
  });
});
