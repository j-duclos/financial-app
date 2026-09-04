import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const reconcileSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Reconcile.tsx"),
  "utf8"
);
const stickySource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/reconcile/ReconcileStickySummary.tsx"),
  "utf8"
);
const equationSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../components/reconcile/ReconcileLiveEquation.tsx"),
  "utf8"
);

describe("Reconcile page", () => {
  it("exports Reconcile component", async () => {
    const mod = await import("./Reconcile");
    expect(typeof mod.default).toBe("function");
  });

  it("keeps account, period, and bank balance inputs", () => {
    expect(reconcileSource).toMatch(/label className="block text-xs font-medium text-gray-500 mb-1">Account/);
    expect(reconcileSource).toMatch(/Period start/);
    expect(reconcileSource).toMatch(/Period end/);
    expect(reconcileSource).toMatch(/Bank balance as of period end/);
    expect(reconcileSource).toMatch(/setAccountId/);
    expect(reconcileSource).toMatch(/setPeriodStart/);
    expect(reconcileSource).toMatch(/setPeriodEnd/);
    expect(reconcileSource).toMatch(/setBankBalanceInput/);
  });

  it("selects transactions locally without refetching setup", () => {
    expect(reconcileSource).toMatch(/function toggleChecked/);
    expect(reconcileSource).toMatch(/function toggleAll/);
    expect(reconcileSource).toMatch(/aria-label="Select all transactions"/);
    expect(reconcileSource).toMatch(/queryKey: \["reconcile-setup", accountId, periodStart, periodEnd\]/);
    expect(reconcileSource).not.toMatch(/queryKey: \["reconcile-setup".*checkedIds/);
    expect(reconcileSource).not.toMatch(/queryKey: \["reconcile-setup".*bankBalance/);
    expect(reconcileSource).toMatch(/setCheckedIds/);
  });

  it("shows live bank / calculated / difference equation", () => {
    expect(reconcileSource).toMatch(/ReconcileLiveEquation/);
    expect(equationSource).toMatch(/Bank statement balance/);
    expect(equationSource).toMatch(/Calculated app balance/);
    expect(equationSource).toMatch(/Difference/);
    expect(equationSource).toMatch(/✓ Balanced/);
    expect(equationSource).toMatch(/Not balanced/);
  });

  it("keeps a sticky summary with selection count and complete action", () => {
    expect(reconcileSource).toMatch(/ReconcileStickySummary/);
    expect(reconcileSource).toMatch(/pb-56/);
    expect(stickySource).toMatch(/fixed bottom-0/);
    expect(stickySource).toMatch(/Period opening balance/);
    expect(stickySource).toMatch(/Selected activity/);
    expect(stickySource).toMatch(/Calculated ending balance/);
    expect(stickySource).toMatch(/Bank statement balance/);
    expect(stickySource).toMatch(/Difference/);
    expect(stickySource).toMatch(/selectedCountLabel/);
    expect(stickySource).toMatch(/Complete Reconciliation/);
    expect(stickySource).toMatch(/completeDisabledReason/);
    expect(stickySource).toMatch(/id="complete-disabled-reason"/);
  });

  it("labels source icons from known transaction data", () => {
    expect(reconcileSource).toMatch(/reconcileSourceTooltip/);
    expect(reconcileSource).toMatch(/labelOverrides/);
    expect(reconcileSource).toMatch(/selectedAccount\?\.institution/);
  });

  it("keeps category as display plus Edit, not inline category architecture", () => {
    expect(reconcileSource).toMatch(/\{t\.category \?\? "—"\}/);
    expect(reconcileSource).toMatch(/>Edit</);
    expect(reconcileSource).not.toMatch(/inline category/i);
  });

  it("computes live balances from loaded rows in cents", () => {
    expect(reconcileSource).toMatch(/reconcileBalanceAfterChecksCents/);
    expect(reconcileSource).toMatch(/selectedActivityCents/);
    expect(reconcileSource).toMatch(/parseSignedBankBalanceCents/);
    expect(reconcileSource).toMatch(/bankBalanceAmountString/);
    expect(reconcileSource).toMatch(/creditBankBalanceHint/);
  });
});
