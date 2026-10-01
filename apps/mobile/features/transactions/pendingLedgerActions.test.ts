import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TimelineRow } from "@budget-app/shared";
import { MATCH_IMPORTED_TRANSACTION_LABEL } from "@budget-app/shared";
import {
  getPendingRowActions,
  pendingRowCanMatchImport,
  pendingRowHasActions,
} from "./pendingLedgerActions";

const dir = dirname(fileURLToPath(import.meta.url));
const listItem = readFileSync(join(dir, "TransactionListItem.tsx"), "utf8");
const screen = readFileSync(join(dir, "TransactionsScreen.tsx"), "utf8");

const row = (partial: Partial<TimelineRow> = {}): TimelineRow =>
  ({
    date: "2026-10-01",
    description: "Rent",
    account_id: 1,
    account_name: "Checking",
    category_id: null,
    category_name: null,
    amount: "-1200.00",
    type: "expense",
    status: "PLANNED",
    source: "rule",
    rule_id: 9,
    transaction_id: 44,
    running_balance: "100.00",
    ...partial,
  }) as TimelineRow;

describe("pendingRowHasActions", () => {
  it("offers match/skip/edit for unmatched planned pending rows", () => {
    expect(pendingRowHasActions(row())).toBe(true);
    expect(pendingRowCanMatchImport(row())).toBe(true);
    expect(getPendingRowActions(row()).map((a) => a.kind)).toEqual([
      "matchImport",
      "skip",
      "edit",
    ]);
    expect(getPendingRowActions(row())[0].label).toBe(MATCH_IMPORTED_TRANSACTION_LABEL);
  });

  it("hides actions after the row is already matched", () => {
    expect(pendingRowHasActions(row({ import_match_status: "matched" }))).toBe(false);
    expect(getPendingRowActions(row({ import_match_status: "matched" }))).toEqual([]);
  });

  it("hides actions for reconciled or forecast-only interest", () => {
    expect(pendingRowHasActions(row({ reconciled: true }))).toBe(false);
    expect(pendingRowHasActions(row({ source: "interest", status: "PLANNED" }))).toBe(false);
  });
});

describe("pending list match wiring", () => {
  it("puts Match imported transaction on the pending row overflow, not as an inline button", () => {
    expect(listItem).toMatch(/pendingRowHasActions/);
    expect(listItem).toMatch(/onPressPendingActions/);
    expect(listItem).toMatch(/ellipsis-h/);
    expect(listItem).not.toMatch(/MATCH_IMPORTED_TRANSACTION_LABEL/);
    expect(screen).toMatch(/PendingRowActionsSheet/);
    expect(screen).toMatch(/resolveExpectedAsImported/);
    expect(screen).toMatch(/MATCH_IMPORTED_TRANSACTION_LABEL/);
    expect(screen).toMatch(/NO_MATCHING_IMPORTED_TRANSACTION_MESSAGE/);
    expect(screen).toMatch(/setNoMatchImportRow/);
    expect(screen).toMatch(/confirmLabel="Skip"/);
    expect(screen).toMatch(/const beginMatchImportRow = useCallback/);
    expect(screen).toMatch(/matchImportMu\.mutate\(\{ plannedId: transactionId, row \}\)/);
    expect(screen).not.toMatch(/getTransactionImportCandidates/);
    expect(screen).not.toMatch(/matchTransactionToImport/);
    expect(screen).not.toMatch(/resolveExpectedAsImportedHonoringUser/);
    const matchBlock = screen.slice(
      screen.indexOf("const beginMatchImportRow = useCallback"),
      screen.indexOf("const beginEditPendingRow = useCallback")
    );
    expect(matchBlock).not.toMatch(/skipTransactionOccurrence/);
  });
});
