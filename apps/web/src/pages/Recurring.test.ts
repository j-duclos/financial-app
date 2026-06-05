import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const recurringSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "Recurring.tsx"),
  "utf8"
);

describe("Recurring page", () => {
  it("exports Recurring component", async () => {
    const mod = await import("./Recurring");
    expect(typeof mod.default).toBe("function");
  });

  it("loads rules and checklist enrichment", () => {
    expect(recurringSource).toMatch(/listRules/);
    expect(recurringSource).toMatch(/getBillsOverview/);
  });

  it("does not render forecast or risk banners", () => {
    expect(recurringSource).not.toMatch(/warnings\.map/);
    expect(recurringSource).not.toMatch(/overdraft/i);
    expect(recurringSource).not.toMatch(/months_after:\s*1/);
  });

  it("uses recurring health display helpers", () => {
    expect(recurringSource).toMatch(/recurringPaymentStatusLabel/);
    expect(recurringSource).toMatch(/RecurringDetailPanel/);
  });

  it("does not allow mark paid without matching a transaction", () => {
    expect(recurringSource).not.toMatch(/billMarkPaid/);
    expect(recurringSource).toMatch(/RecurringDetailPanel/);
  });

  it("pairs day sections in two columns on large screens", () => {
    expect(recurringSource).toMatch(/grid-cols-1 lg:grid-cols-2/);
    expect(recurringSource).toMatch(/groupRecurringItemsByDay/);
  });
});
