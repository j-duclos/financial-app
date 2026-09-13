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
  });

  it("does not auto-scroll ordinary Transactions-tab opening", () => {
    expect(screen).not.toMatch(/initialScrollIndex/);
    expect(screen).not.toMatch(/findDefaultLedgerOpenIndex/);
    expect(screen).not.toMatch(/ledgerOpenScrollIndex/);
    expect(screen).not.toMatch(/estimateLedgerOffset/);
    expect(screen).not.toMatch(/getItemLayout/);
    expect(screen).not.toMatch(/onContentSizeChange/);
  });

  it("cancels delayed auto-scroll once the user starts dragging", () => {
    expect(screen).toMatch(/onScrollBeginDrag/);
    expect(screen).toMatch(/userHasDraggedRef/);
    expect(screen).toMatch(/shouldApplyFocusScroll/);
  });

  it("keeps explicit deep-link positioning on a separate path", () => {
    expect(screen).toMatch(/resolveLedgerOpenMode/);
    expect(screen).toMatch(/hasLedgerDeepLinkFocus/);
    expect(screen).toMatch(/scrollToIndex/);
    expect(screen).toMatch(/forecast-risk/);
    expect(screen).toMatch(/ledger-event/);
    expect(screen).toMatch(/focusScrollAppliedRef/);
    expect(screen).toMatch(/focusTransactionId/);
    expect(screen).toMatch(/focusRuleId/);
    expect(screen).toMatch(/focusDate/);
    expect(screen).toMatch(/focusDescription/);
  });

  it("remounts at the top on account or range change without a boundary scroll", () => {
    expect(screen).toMatch(/ordinaryLedgerPositionKey/);
    expect(screen).toMatch(/filters\.accountId/);
    expect(screen).toMatch(/filters\.timeFilter/);
    expect(screen).toMatch(/forecastDays/);
    expect(screen).toMatch(/const listMountKey = hasLedgerDeepLinkFocus/);
    expect(screen).toMatch(/: ledgerListKey;/);
    expect(screen).not.toMatch(/findLedgerBoundaryIndex/);
  });

  it("does not remount the list on pull-to-refresh or highlight timers", () => {
    expect(screen).toMatch(/RefreshControl/);
    expect(screen).not.toMatch(/listMountKey[\s\S]{0,200}focusHighlightActive/);
    expect(screen).toMatch(/removeClippedSubviews=\{false\}/);
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
