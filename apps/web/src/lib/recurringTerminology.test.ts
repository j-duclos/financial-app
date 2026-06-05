import { describe, expect, it } from "vitest";
import { RECURRING_SUMMARY } from "./recurringTerminology";

describe("recurringTerminology", () => {
  it("defines recurring summary labels and help copy", () => {
    expect(RECURRING_SUMMARY.activeRules.label).toBe("Active recurring rules");
    expect(RECURRING_SUMMARY.monthlyObligations.label).toBe("Monthly recurring obligations");
    expect(RECURRING_SUMMARY.upcomingCharges.label).toBe("Upcoming charges (30d)");
    expect(RECURRING_SUMMARY.missedPayments.label).toBe("Missed payments");
    expect(RECURRING_SUMMARY.dueSoon.label).toBe("Due soon (5d)");
    expect(RECURRING_SUMMARY.monthlyObligations.help).toMatch(/cadence/i);
    expect(RECURRING_SUMMARY.dueSoon.help).toMatch(/5 days/i);
  });
});
