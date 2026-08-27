import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reconcilePath, reconcileSessionDetailPath } from "./navigation";
import { reconcileQueryKeys } from "./queryKeys";

const dir = dirname(fileURLToPath(import.meta.url));
const screenSource = readFileSync(join(dir, "ReconcileScreen.tsx"), "utf8");
const txnRowSource = readFileSync(join(dir, "ReconcileTxnRow.tsx"), "utf8");
const queryKeysSource = readFileSync(join(dir, "queryKeys.ts"), "utf8");
const routeSource = readFileSync(join(dir, "../../app/(app)/reconcile.tsx"), "utf8");
const moreSource = readFileSync(join(dir, "../more/MoreScreen.tsx"), "utf8");
const accountDetailSource = readFileSync(join(dir, "../accounts/AccountDetailScreen.tsx"), "utf8");
const financialRefreshSource = readFileSync(
  join(dir, "../../lib/financialQueryRefresh.ts"),
  "utf8"
);

describe("Reconcile routes and placeholder removal", () => {
  it("reconcile route no longer uses PlaceholderScreen", () => {
    expect(routeSource).not.toMatch(/PlaceholderScreen/);
    expect(routeSource).not.toMatch(/coming soon/i);
    expect(routeSource).toMatch(/ReconcileScreen/);
  });

  it("remains under More and supports account deep link", () => {
    expect(moreSource).toMatch(
      /title: "Reconcile", href: "\/reconcile", subtitle: "Match statements to transactions"/
    );
    expect(moreSource).not.toMatch(/title: "Reconcile".*Web only for beta/);
    expect(accountDetailSource).toMatch(/Reconcile account/);
    expect(accountDetailSource).toMatch(/reconcilePath\(account\.id\)/);
    expect(reconcilePath(9)).toEqual({ pathname: "/reconcile", params: { account: "9" } });
    expect(reconcileSessionDetailPath(3)).toBe("/reconcile/session/3");
  });
});

describe("Reconcile flow contracts", () => {
  it("uses canonical setup/preview/complete APIs and does not sum locally", () => {
    expect(screenSource).toMatch(/getReconcileSetup/);
    expect(screenSource).toMatch(/previewReconciliation/);
    expect(screenSource).toMatch(/completeReconciliation/);
    expect(screenSource).toMatch(/listReconciliationSessions/);
    expect(screenSource).not.toMatch(/reduce\(|\.reduce\(/);
    expect(screenSource).not.toMatch(/reconcileBalanceAfterChecks/);
    expect(screenSource).toMatch(/can_complete/);
  });

  it("keeps cleared toggles distinct from reconciled history", () => {
    expect(txnRowSource).toMatch(/Mark .* as cleared/);
    expect(screenSource).toMatch(/Uncleared/);
    expect(screenSource).toMatch(/Cleared for this statement/);
    expect(screenSource).not.toMatch(/Already reconciled/);
  });

  it("warns when abandoning unsaved in-progress state", () => {
    expect(screenSource).toMatch(/Checked items are not saved until you finish/);
    expect(screenSource).toMatch(/Finish reconciliation/);
  });

  it("does not load forecast/timeline/dashboard while browsing reconcile", () => {
    expect(screenSource).not.toMatch(/getScenarioComparison|timeline-calendar|dashboard-summary|extended-cash-risk/);
    expect(screenSource).toMatch(/useAccountOptions/);
  });
});

describe("Reconcile query keys", () => {
  it("scopes setup/preview/sessions by account", () => {
    expect(reconcileQueryKeys.meta(5)).toEqual(["reconcile", "meta", 5]);
    expect(reconcileQueryKeys.sessions(5)).toEqual(["reconcile", "sessions", 5]);
    expect(reconcileQueryKeys.setup(5, "2026-08-01", "2026-08-20")).toEqual([
      "reconcile",
      "setup",
      5,
      "2026-08-01",
      "2026-08-20",
    ]);
  });

  it("invalidates financial caches only after complete/undo mutations", () => {
    expect(queryKeysSource).toMatch(/invalidateFinancialQueries/);
    expect(queryKeysSource).toMatch(/invalidateAfterReconcileMutation/);
    expect(financialRefreshSource).toMatch(/reconcile-setup/);
  });
});
