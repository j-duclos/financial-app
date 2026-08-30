/**
 * Cross-platform contract: clients must not advance settled recurrence independently.
 * Web and Mobile both prefer backend next_occurrence_date.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RecurringRule } from "@budget-app/shared";
import { resolveRecurringNextOccurrence } from "./recurringDisplay";

const mobileDisplay = readFileSync(
  join(__dirname, "../../../mobile/features/recurring/recurringDisplay.ts"),
  "utf8"
);
const webDisplay = readFileSync(join(__dirname, "recurringDisplay.ts"), "utf8");

describe("cross-platform next occurrence contract", () => {
  it("web and mobile prefer backend next_occurrence_date", () => {
    expect(webDisplay).toMatch(/next_occurrence_date/);
    expect(mobileDisplay).toMatch(/next_occurrence_date/);
    expect(webDisplay).not.toMatch(/getNextRuleRunDate/);
    expect(mobileDisplay).not.toMatch(/getNextRuleRunDate|generateRuleOccurrences/);
  });

  it("web resolveRecurringNextOccurrence does not invent a post-settlement date", () => {
    const rule = {
      id: 1,
      household: 1,
      name: "Rent",
      account: { id: 1, name: "Checking" },
      category: null,
      direction: "EXPENSE",
      amount: "1000",
      currency: "USD",
      frequency: "MONTHLY_DAY",
      interval: 1,
      day_of_week: null,
      day_of_month: 1,
      nth_week: null,
      start_date: "2024-01-01",
      end_date: null,
      active: true,
      paused_at: null,
      notes: null,
      next_occurrence_date: "2026-07-01",
      created_at: "",
      updated_at: "",
    } as RecurringRule;

    // Settled May occurrence must not push the client to invent June when backend says July.
    expect(
      resolveRecurringNextOccurrence(
        rule,
        {
          id: 1,
          name: "Rent",
          account: { id: 1, name: "Checking" },
          due_date: "2026-05-01",
          amount: "1000",
          category: null,
          source_type: "rule",
          transaction_id: 9,
          rule_id: 1,
          status: "paid",
          paid_date: "2026-05-01",
          matched_transaction_id: 9,
          is_overdue: false,
          days_until_due: -60,
          skipped: false,
          notes: "",
        },
        "2026-06-15"
      )
    ).toBe("2026-07-01");
  });
});
