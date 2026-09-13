import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const screen = readFileSync(join(dir, "TransactionsScreen.tsx"), "utf8");
const item = readFileSync(join(dir, "TransactionListItem.tsx"), "utf8");

describe("Transactions ordinary vs focus scrolling", () => {
  it("does not schedule 50/200/500ms ordinary scroll retries", () => {
    expect(screen).not.toMatch(/applyLedgerAnchorScroll/);
    expect(screen).not.toMatch(/setTimeout\(\(\) => applyLedgerAnchorScroll/);
    expect(screen).not.toMatch(/setTimeout\([^)]*,\s*50\)/);
    expect(screen).not.toMatch(/setTimeout\([^)]*,\s*200\)/);
    expect(screen).not.toMatch(/setTimeout\([^)]*,\s*500\)/);
    expect(screen).not.toMatch(/onContentSizeChange/);
    expect(screen).not.toMatch(/initialScrollIndex/);
  });

  it("positions ordinary open once with scrollToIndex after rows exist", () => {
    expect(screen).toMatch(/findOrdinaryLedgerOpenIndex/);
    expect(screen).toMatch(/ordinaryInitialScrollAppliedRef/);
    expect(screen).toMatch(/shouldApplyOrdinaryInitialScroll/);
    expect(screen).toMatch(/scrollToIndex/);
    expect(screen).toMatch(/ordinaryFallbackUsedRef/);
  });

  it("cancels unfinished ordinary positioning when the user starts dragging", () => {
    expect(screen).toMatch(/onScrollBeginDrag/);
    expect(screen).toMatch(/userHasDraggedRef/);
    expect(screen).toMatch(/ordinaryInitialScrollAppliedRef\.current = ordinaryPositionKeyRef/);
  });

  it("keeps explicit deep-link positioning on a separate path", () => {
    expect(screen).toMatch(/resolveLedgerOpenMode/);
    expect(screen).toMatch(/hasLedgerDeepLinkFocus/);
    expect(screen).toMatch(/forecast-risk/);
    expect(screen).toMatch(/ledger-event/);
    expect(screen).toMatch(/focusScrollAppliedRef/);
    expect(screen).toMatch(/focusTransactionId/);
    expect(screen).toMatch(/focusRuleId/);
    expect(screen).toMatch(/focusDate/);
    expect(screen).toMatch(/focusDescription/);
    expect(screen).toMatch(/if \(hasLedgerDeepLinkFocus \|\| !ledgerListReady\) return/);
    expect(screen).toMatch(/if \(!hasLedgerDeepLinkFocus \|\| !ledgerListReady\) return/);
  });

  it("allows a new ordinary position on account or range change, not on refresh", () => {
    expect(screen).toMatch(/ordinaryLedgerPositionKey/);
    expect(screen).toMatch(/ordinaryInitialScrollAppliedRef\.current = null/);
    expect(screen).toMatch(/: ledgerListKey;/);
    expect(screen).not.toMatch(/listMountKey[\s\S]{0,200}focusHighlightActive/);
    expect(screen).toMatch(/RefreshControl/);
  });
});

describe("Transactions section chrome", () => {
  it("renders distinct Recent, Pending, and Upcoming headers", () => {
    expect(item).toMatch(/section-pending/);
    expect(item).toMatch(/section-upcoming/);
    expect(item).toMatch(/warningBg/);
    expect(item).toMatch(/tintMuted/);
    expect(item).toMatch(/Forecast/);
    expect(item).toMatch(/item\.title\.toUpperCase\(\)/);
  });
});
