import { describe, expect, it } from "vitest";
import { computeBiggestDriversFromTransactions, formatDriverCompact } from "./dayBiggestDrivers";

describe("dayBiggestDrivers", () => {
  it("sorts by absolute impact and skips transfer inflows", () => {
    const drivers = computeBiggestDriversFromTransactions([
      {
        id: 1,
        description: "Rent",
        account_name: "Checking",
        amount: "-3100",
        category: null,
        kind: "expense",
        source: "rule",
        balance_after: null,
        is_transfer: false,
      },
      {
        id: 2,
        description: "Payroll",
        account_name: "Checking",
        amount: "1835",
        category: null,
        kind: "income",
        source: "rule",
        balance_after: null,
        is_transfer: false,
      },
      {
        id: 3,
        description: "Xfer in",
        account_name: "Checking",
        amount: "500",
        category: null,
        kind: "transfer",
        source: "rule",
        balance_after: null,
        is_transfer: true,
      },
    ]);
    expect(drivers[0].description).toBe("Rent");
    expect(drivers[1].description).toBe("Payroll");
    expect(drivers).toHaveLength(2);
  });

  it("formats compact driver lines", () => {
    expect(formatDriverCompact({ description: "Rent", amount: "-3100", kind: "expense" })).toBe(
      "Rent: -$3,100"
    );
  });
});
