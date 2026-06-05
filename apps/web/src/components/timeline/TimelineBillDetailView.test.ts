import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));

describe("TimelineBillDetailView", () => {
  it("splits payment history and forecast with ascending order helper", () => {
    const source = readFileSync(join(dir, "TimelineBillDetailView.tsx"), "utf8");
    expect(source).toContain("splitRecurringBillPayments");
    expect(source).toContain('title="Payment history"');
    expect(source).toContain('title="Payment forecast"');
    expect(source).not.toContain("payment_history.slice(0, 12)");
  });

  it("requires ledger match instead of mark paid", () => {
    const source = readFileSync(join(dir, "TimelineBillDetailView.tsx"), "utf8");
    expect(source).not.toMatch(/billMarkPaid/);
    expect(source).not.toMatch(/Mark paid/);
    expect(source).toMatch(/Match from ledger/);
  });
});
