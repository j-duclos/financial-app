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
  it("match action calls the single automatic-resolution API", () => {
    expect(transactionsSource).toMatch(/resolveExpectedAsImported/);
    expect(transactionsSource).toMatch(/matchImportMu\.mutate\(transactionId\)/);
    expect(transactionsSource).not.toMatch(/getTransactionImportCandidates/);
    expect(transactionsSource).not.toMatch(/matchTransactionToImport/);
    expect(transactionsSource).not.toMatch(/importedTransactionId/);
  });

  it("does not render a candidate-selection modal", () => {
    expect(transactionsSource).not.toMatch(/ImportMatchDialog/);
    expect(transactionsSource).not.toMatch(/pendingMatchCandidate/);
    expect(transactionsSource).not.toMatch(/onConfirmMatch/);
    expect(transactionsSource).not.toMatch(/NO_IMPORT_CANDIDATES_MESSAGE/);
    expect(transactionsSource).not.toMatch(/import-candidates/);
    expect(transactionsSource).not.toMatch(/selectableImportMatchCandidates/);
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

  it("success refreshes ledger and account data through afterFinancialEdit", () => {
    const matchBlock = transactionsSource.slice(
      transactionsSource.indexOf("const matchImportMu = useMutation"),
      transactionsSource.indexOf("const moveDateMu = useMutation")
    );
    expect(matchBlock).toMatch(/afterFinancialEdit\(\{ refreshAccounts: true \}\)/);
    expect(matchBlock).toMatch(/onSuccess:/);
  });

  it("failed request leaves the pending row intact and displays an inline error", () => {
    const matchBlock = transactionsSource.slice(
      transactionsSource.indexOf("const matchImportMu = useMutation"),
      transactionsSource.indexOf("const moveDateMu = useMutation")
    );
    const errorBlock = matchBlock.slice(matchBlock.indexOf("onError:"));
    expect(errorBlock).toMatch(/setDeleteError\(msg \|\| "Could not match imported transaction"\)/);
    expect(errorBlock).not.toMatch(/afterFinancialEdit/);
    expect(errorBlock).not.toMatch(/skipOccurrenceMu/);
    expect(transactionsSource).toMatch(/\{deleteError && \(/);
  });

  it("disables actions while the resolve request is running", () => {
    expect(transactionsSource).toMatch(/lifecyclePending[\s\S]*matchImportMu\.isPending/);
    expect(transactionsSource).toMatch(/if \(matchImportMu\.isPending \|\| forecastActionsLocked\) return;/);
    expect(pendingSource).toMatch(/actionsDisabled=\{actionsPending\}/);
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

  it("does not render an inline Match imported transaction button on the row", () => {
    expect(rowSource).not.toMatch(/MATCH_IMPORTED_TRANSACTION_LABEL/);
    expect(rowSource).not.toMatch(/onClick=\{\(\) => onMatchImport\(\)\}/);
    expect(rowSource).not.toMatch(/Match imported transaction/);
  });

  it("puts Match imported transaction in the expected-row three-dot menu", () => {
    expect(menuSource).toMatch(/onMatchImport/);
    expect(menuSource).toMatch(/MATCH_IMPORTED_TRANSACTION_LABEL/);
    expect(menuSource).toMatch(/key: "matchImport"/);
    expect(rowSource).toMatch(/onMatchImport=\{variant === "expected" \? onMatchImport : undefined\}/);
  });

  it("shows matched status instead of another match action", () => {
    expect(rowSource).toMatch(/Matched to bank import/);
    expect(rowSource).toMatch(/isImportMatchStatusMatched\(row\.importMatchStatus\)/);
  });
});

describe("planned delete vs skip", () => {
  it("pending expected rows use Skip only — Delete removed because skip records rule occurrence suppression", () => {
    expect(pendingSource).toMatch(/not manual delete or batch delete/);
    expect(pendingSource).not.toMatch(/onDeleteRow/);
    expect(menuSource).not.toMatch(/Delete \(advanced\)/);
  });
});

describe("batch delete selection", () => {
  it("pending expected rows are not batch-selectable", () => {
    expect(pendingSource).not.toMatch(/onToggleSelected/);
    expect(pendingSource).not.toMatch(/onSelectedChange/);
    expect(pendingSource).not.toMatch(/canSelectTransactionForBatchDelete/);
    expect(pendingSource).toMatch(/selectAllDisabled/);
  });

  it("removes projection-only batch selection helpers from Transactions page", () => {
    expect(transactionsSource).not.toMatch(/pendingSelectionKeys/);
    expect(transactionsSource).not.toMatch(/toggleUnresolvedSelection/);
    expect(transactionsSource).not.toMatch(/projectionSelectionKey/);
  });

  it("planned scheduled rows are excluded in canSelectTransactionForBatchDelete", () => {
    expect(rowSource).toMatch(/plannedScheduled/);
    expect(rowSource).not.toMatch(/projectionSelectionKey/);
  });

  it("pending expected rows keep Skip available", () => {
    expect(pendingSource).toMatch(/onSkipRow/);
    expect(pendingSource).toMatch(/onSkip=\{editable \? \(\) => onSkipRow/);
  });
});
