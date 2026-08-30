import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const transactionsSource = readFileSync(join(webRoot, "pages/Transactions.tsx"), "utf8");
const pendingSource = readFileSync(
  join(webRoot, "components/transactions/PendingExpectedSection.tsx"),
  "utf8"
);
const rowSource = readFileSync(join(webRoot, "components/transactions/TransactionRow.tsx"), "utf8");
const menuSource = readFileSync(
  join(webRoot, "components/transactions/TransactionContextMenu.tsx"),
  "utf8"
);

describe("Transactions import match wiring", () => {
  it("match flow uses backend import candidates and match endpoint", () => {
    expect(transactionsSource).toMatch(/getTransactionImportCandidates/);
    expect(transactionsSource).toMatch(/matchTransactionToImport/);
    expect(transactionsSource).toMatch(/ImportMatchDialog/);
    expect(transactionsSource).toMatch(/\["transactions", "import-candidates", matchImportFlow\?\.plannedId\]/);
  });

  it("match action never calls skipTransactionOccurrence", () => {
    expect(transactionsSource).toMatch(/async function beginMatchImportRow/);
    const matchBlock = transactionsSource.slice(
      transactionsSource.indexOf("async function beginMatchImportRow"),
      transactionsSource.indexOf("async function moveDateExpectedRow")
    );
    expect(matchBlock).not.toMatch(/skipTransactionOccurrence/);
    expect(matchBlock).not.toMatch(/skipOccurrenceMu\.mutate/);
    expect(transactionsSource).not.toMatch(/matchesImportedRow/);
  });

  it("skip still uses skipTransactionOccurrence from explicit skip handlers", () => {
    expect(transactionsSource).toMatch(/skipOccurrenceMu = useMutation\([\s\S]*skipTransactionOccurrence/);
    expect(transactionsSource).toMatch(/confirmSkipOccurrence[\s\S]*skipOccurrenceMu\.mutate/);
  });

  it("requires explicit confirmation before match mutation", () => {
    expect(transactionsSource).toMatch(/pendingMatchCandidate/);
    expect(transactionsSource).toMatch(/onConfirmMatch/);
    expect(transactionsSource).toMatch(/matchImportMu\.mutate\(\{/);
  });

  it("does not auto-skip when no candidates exist", () => {
    expect(transactionsSource).toMatch(/selectableImportMatchCandidates/);
    expect(transactionsSource).not.toMatch(/selectableImportCandidates[\s\S]{0,400}skipOccurrenceMu\.mutate/);
  });

  it("removes import candidate cache after successful match", () => {
    expect(transactionsSource).toMatch(/removeQueries\([\s\S]*import-candidates/);
  });
});

describe("Pending expected row actions", () => {
  it("offers match import for eligible planned rows without timeline-based gating", () => {
    expect(pendingSource).toMatch(/isPlannedScheduledTimelineRow\(row\.row\)/);
    expect(pendingSource).toMatch(/isImportMatchStatusMatched/);
    expect(pendingSource).toMatch(/onMatchImportRow/);
    expect(pendingSource).not.toMatch(/scheduleHighlight \? \(\) => onMatchImportRow/);
  });

  it("does not expose delete for pending expected rows", () => {
    expect(pendingSource).not.toMatch(/onDeleteRow/);
    expect(pendingSource).not.toMatch(/onDelete=/);
    expect(menuSource).not.toMatch(/Delete \(advanced\)/);
  });

  it("uses semantic match label on the row button", () => {
    expect(rowSource).toMatch(/MATCH_IMPORTED_TRANSACTION_LABEL/);
    expect(rowSource).not.toMatch(/Matched Import/);
  });

  it("shows matched status instead of another match action", () => {
    expect(rowSource).toMatch(/Matched to bank import/);
    expect(rowSource).toMatch(/isImportMatchStatusMatched\(row\.importMatchStatus\)/);
  });
});

describe("planned delete vs skip", () => {
  it("pending expected rows use Skip only — Delete removed because skip records rule occurrence suppression", () => {
    expect(pendingSource).toMatch(/not manual delete/);
    expect(pendingSource).not.toMatch(/onDeleteRow/);
    expect(menuSource).not.toMatch(/Delete \(advanced\)/);
  });
});
