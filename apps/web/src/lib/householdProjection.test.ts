import { describe, expect, it } from "vitest";
import type { Account, TimelineRow } from "@budget-app/shared";
import { buildHouseholdProjectionLines } from "./householdProjection";

function account(partial: Partial<Account> & Pick<Account, "id" | "name">): Account {
  return {
    household: 1,
    account_type: "CHECKING",
    currency: "USD",
    status: "active",
    ...partial,
  } as Account;
}

function timelineRow(partial: Partial<TimelineRow> & Pick<TimelineRow, "account_id" | "date">): TimelineRow {
  return {
    description: "Rent",
    account_name: "Checking",
    category_id: null,
    category_name: null,
    amount: "-50.00",
    type: "OUTFLOW",
    status: "PLANNED",
    source: "rule",
    rule_id: 1,
    transaction_id: 1,
    running_balance: "10.00",
    ...partial,
  } as TimelineRow;
}

describe("buildHouseholdProjectionLines", () => {
  it("prefers canonical balance_after over chronological running_balance", () => {
    const lines = buildHouseholdProjectionLines(
      [
        timelineRow({
          account_id: 1,
          date: "2026-02-01",
          running_balance: "10.00",
          balance_after: "80.00",
        }),
      ],
      [account({ id: 1, name: "Checking" })],
      "2026-01-20"
    );
    expect(lines[0]?.text).toContain("$80.00");
    expect(lines[0]?.text).not.toContain("$10.00");
  });
});
