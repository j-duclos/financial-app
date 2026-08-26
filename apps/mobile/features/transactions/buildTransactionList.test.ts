import { describe, expect, it } from "vitest";
import type { Transaction } from "@budget-app/shared";
import { buildTransactionListRows, indexTimelineBalances } from "@/features/transactions/buildTransactionList";
import { DEFAULT_TRANSACTION_FILTERS } from "@/features/transactions/types";

const txn = (partial: Partial<Transaction> & Pick<Transaction, "id" | "payee" | "amount" | "date">): Transaction =>
  ({
    direction: "OUTFLOW",
    cleared: true,
    reconciled: false,
    memo: "",
    tags: [],
    account: { id: 1, name: "Checking" } as Transaction["account"],
    category: null,
    ...partial,
  }) as Transaction;

describe("buildTransactionListRows", () => {
  it("places upcoming before history and hides reconciled running balances when sealed", () => {
    const balanceMap = indexTimelineBalances([
      {
        date: "2026-06-01",
        description: "Old",
        account_id: 1,
        account_name: "Checking",
        category_id: null,
        category_name: null,
        amount: "-10.00",
        type: "expense",
        status: "CLEARED",
        source: "actual",
        rule_id: null,
        transaction_id: 10,
        running_balance: "100.00",
        reconciled: true,
        reconciled_balance: "100.00",
      },
    ]);

    const rows = buildTransactionListRows({
      upcoming: [
        {
          date: "2026-06-10",
          description: "Rent",
          account_id: 1,
          account_name: "Checking",
          category_id: 2,
          category_name: "Rent",
          amount: "-1200.00",
          type: "expense",
          status: "PLANNED",
          source: "rule",
          rule_id: 5,
          transaction_id: null,
          running_balance: "800.00",
        },
      ],
      history: [txn({ id: 10, payee: "Old", amount: "-10.00", date: "2026-06-01", reconciled: true })],
      balanceMap,
      filters: { ...DEFAULT_TRANSACTION_FILTERS, showReconciled: true },
      today: "2026-06-05",
    });

    expect(rows[0]).toMatchObject({ kind: "section", title: "Upcoming" });
    expect(rows.some((r) => r.kind === "history")).toBe(true);
    const historyRow = rows.find((r) => r.kind === "history");
    expect(historyRow && historyRow.kind === "history" ? historyRow.runningBalance : null).toBeNull();
  });

  it("defaults to hiding reconciled transactions via API params builder", () => {
    expect(DEFAULT_TRANSACTION_FILTERS.showReconciled).toBe(false);
  });
});
