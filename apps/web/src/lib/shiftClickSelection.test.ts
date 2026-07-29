import { describe, expect, it } from "vitest";
import { ledgerRowSelectionKey, sliceIdsByAnchor } from "./shiftClickSelection";

describe("sliceIdsByAnchor", () => {
  const ids = [10, 20, 30, 40, 50];

  it("returns inclusive range forward", () => {
    expect(sliceIdsByAnchor(ids, 20, 40)).toEqual([20, 30, 40]);
  });

  it("returns inclusive range backward", () => {
    expect(sliceIdsByAnchor(ids, 40, 20)).toEqual([20, 30, 40]);
  });

  it("returns single id when anchor missing", () => {
    expect(sliceIdsByAnchor(ids, 99, 30)).toEqual([30]);
  });

  it("returns empty when target missing", () => {
    expect(sliceIdsByAnchor(ids, 20, 99)).toEqual([]);
  });
});

describe("ledgerRowSelectionKey", () => {
  it("prefers transaction id", () => {
    expect(
      ledgerRowSelectionKey({
        transactionId: 7,
        date: "2026-08-01",
        accountId: 1,
        source: { rule_id: 3 },
      })
    ).toBe("txn:7");
  });

  it("uses rule key when no transaction id", () => {
    expect(
      ledgerRowSelectionKey({
        transactionId: null,
        date: "2026-08-01",
        accountId: 1,
        source: { rule_id: 3 },
      })
    ).toBe("rule:3:1:2026-08-01");
  });
});
