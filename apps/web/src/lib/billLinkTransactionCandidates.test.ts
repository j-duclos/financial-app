import { describe, expect, it } from "vitest";
import {
  filterLinkableLedgerTransactions,
  rankTransactionsForBillLink,
  scoreTransactionForBillLink,
} from "./billLinkTransactionCandidates";

const bill = {
  name: "Hulu",
  amount: "35.00",
  due_date: "2026-05-04",
  rule_id: 42,
};

describe("billLinkTransactionCandidates", () => {
  it("scores matching payee and amount highly", () => {
    const score = scoreTransactionForBillLink(bill, {
      payee: "Hulu",
      amount: "-35.00",
      date: "2026-05-04",
    });
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it("excludes rule forecast rows from link candidates", () => {
    const filtered = filterLinkableLedgerTransactions(
      [
        { id: 1, payee: "Netflix", amount: "-19.09", date: "2026-06-17", rule_id: 42, status: "PLANNED" } as never,
        { id: 2, payee: "Netflix", amount: "-19.09", date: "2026-05-17", rule_id: null, status: "CLEARED" } as never,
      ],
      bill
    );
    expect(filtered.map((t) => t.id)).toEqual([2]);
  });

  it("ranks likely matches above unrelated rows", () => {
    const { suggested, other } = rankTransactionsForBillLink(
      [
        { id: 1, payee: "Gen's Rent", amount: "-1500", date: "2026-05-30" } as never,
        { id: 2, payee: "Hulu", amount: "-35.00", date: "2026-05-04" } as never,
      ],
      bill
    );
    expect(suggested[0]?.txn.id).toBe(2);
    expect(other.some((r) => r.txn.id === 1)).toBe(true);
  });
});
