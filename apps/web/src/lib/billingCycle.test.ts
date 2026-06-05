import { describe, it, expect, vi, afterEach } from "vitest";
import { nextBillingCycleEndDate } from "./billingCycle";

describe("nextBillingCycleEndDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns same-month date when closing day is still ahead", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 10)); // May 10, 2026
    expect(nextBillingCycleEndDate(15)).toBe("2026-05-15");
  });

  it("rolls to next month when closing day already passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20)); // May 20, 2026
    expect(nextBillingCycleEndDate(15)).toBe("2026-06-15");
  });
});
