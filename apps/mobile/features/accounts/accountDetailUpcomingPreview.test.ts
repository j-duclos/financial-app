import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@budget-app/shared";
import { accountDetailUpcomingPreviewRows } from "./accountDetailUpcomingPreview";
import { partitionTimelineForLedger } from "@/features/transactions/buildTransactionList";

const today = "2026-08-29";
const accountId = 42;

function timelineRow(partial: Partial<TimelineRow> & Pick<TimelineRow, "date" | "description" | "amount">): TimelineRow {
  return {
    account_id: accountId,
    source: "rule",
    status: "PLANNED",
    rule_id: 7,
    ...partial,
  } as TimelineRow;
}

describe("accountDetailUpcomingPreviewRows", () => {
  it("includes recurring projected rows when no persisted future transactions exist", () => {
    const recurring = timelineRow({
      date: "2026-09-05",
      description: "Rent",
      amount: "-1200.00",
    });
    const preview = accountDetailUpcomingPreviewRows([recurring], accountId, today, 5);
    expect(preview).toHaveLength(1);
    expect(preview[0].description).toBe("Rent");
    expect(preview[0].source).toBe("rule");
  });

  it("orders pending before forecast rows like the Transactions ledger", () => {
    const pending = timelineRow({
      date: today,
      description: "Due today",
      amount: "-50.00",
    });
    const future = timelineRow({
      date: "2026-09-01",
      description: "Paycheck",
      amount: "2000.00",
    });
    const timeline = [future, pending];
    const preview = accountDetailUpcomingPreviewRows(timeline, accountId, today, 5);
    const { pending: ledgerPending, upcoming: ledgerUpcoming } = partitionTimelineForLedger(
      timeline,
      today,
      accountId
    );
    expect(preview.map((r) => r.description)).toEqual([
      ...ledgerPending.map((r) => r.description),
      ...ledgerUpcoming.map((r) => r.description),
    ]);
  });

  it("returns empty only when canonical timeline has no pending or forecast rows", () => {
    const pastPosted = timelineRow({
      date: "2026-08-20",
      description: "Old",
      amount: "-10.00",
      status: "CLEARED",
      source: "actual",
    });
    expect(accountDetailUpcomingPreviewRows([pastPosted], accountId, today, 5)).toHaveLength(0);
    expect(accountDetailUpcomingPreviewRows([], accountId, today, 5)).toHaveLength(0);
  });

  it("scopes rows to the selected account", () => {
    const otherAccount = timelineRow({
      date: "2026-09-02",
      description: "Other",
      amount: "-1.00",
      account_id: 99,
    });
    expect(accountDetailUpcomingPreviewRows([otherAccount], accountId, today, 5)).toHaveLength(0);
  });

  it("bounds the preview without changing ledger ordering semantics", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      timelineRow({
        date: `2026-09-${String(i + 1).padStart(2, "0")}`,
        description: `Row ${i}`,
        amount: "-1.00",
      })
    );
    const preview = accountDetailUpcomingPreviewRows(rows, accountId, today, 5);
    expect(preview).toHaveLength(5);
    expect(preview[0].description).toBe("Row 0");
    expect(preview[4].description).toBe("Row 4");
  });
});
